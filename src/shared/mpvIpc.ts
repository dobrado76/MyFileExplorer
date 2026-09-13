/** One JSON object per line from mpv `--input-ipc-server`. */
export type MpvIpcMessage = {
  request_id?: number
  data?: unknown
  error?: string
  event?: string
}

/** Split complete JSON lines; leave a partial trailing line in `rest`. */
export function takeMpvIpcMessages(buf: string): { rest: string; messages: MpvIpcMessage[] } {
  const parts = buf.split('\n')
  const rest = buf.endsWith('\n') ? '' : (parts.pop() ?? '')
  const messages: MpvIpcMessage[] = []
  for (const part of parts) {
    const line = part.trim()
    if (!line) continue
    try {
      messages.push(JSON.parse(line) as MpvIpcMessage)
    } catch {
      /* ignore truncated / non-JSON */
    }
  }
  return { rest, messages }
}

export function mpvIpcReplyData(
  messages: MpvIpcMessage[],
  requestId: number
): { found: boolean; data?: unknown } {
  for (const msg of messages) {
    if (msg.event) continue
    if (msg.request_id === requestId) return { found: true, data: msg.data }
  }
  return { found: false }
}

/** Fold get_property replies (skip events) into a Keep Playing / Dock snapshot. */
export function foldMpvPlaybackReplies(
  messages: MpvIpcMessage[],
  into: {
    seconds: number | null
    paused: boolean | null
    haveTime: boolean
    havePause: boolean
  },
  ids: { time: number; pause: number } = { time: 1, pause: 2 }
): void {
  const t = mpvIpcReplyData(messages, ids.time)
  const p = mpvIpcReplyData(messages, ids.pause)
  if (t.found && !into.haveTime) {
    into.haveTime = true
    into.seconds =
      typeof t.data === 'number' && Number.isFinite(t.data) ? Math.max(0, t.data) : null
  }
  if (p.found && !into.havePause) {
    into.havePause = true
    into.paused = typeof p.data === 'boolean' ? p.data : null
  }
}
