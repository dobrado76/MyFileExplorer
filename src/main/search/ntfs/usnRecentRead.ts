import type { UsnRecentEntry } from '@shared/schemas/usn'
import {
  queryUsnJournal,
  readUsnJournal,
  WINERR_JOURNAL_ENTRY_DELETED,
  type UsnJournalInfo
} from './usnNative'

export function journalStartUsn(info: UsnJournalInfo, lookback: bigint): bigint {
  const floor = info.lowestValidUsn > info.firstUsn ? info.lowestValidUsn : info.firstUsn
  let start = info.nextUsn > lookback + floor ? info.nextUsn - lookback : floor
  if (start < floor) start = floor
  if (start >= info.nextUsn && info.nextUsn > floor) start = floor
  return start
}

export function readRecentFromHandle(
  h: unknown,
  info: UsnJournalInfo,
  cap: number
): { entries: UsnRecentEntry[]; err: number } {
  let lookback = 2_000_000n
  const maxLook = 32_000_000n
  let ring: UsnRecentEntry[] = []
  let lastErr = 0
  let working = info
  while (lookback <= maxLook) {
    let start = journalStartUsn(working, lookback)
    const startedAt = start
    const floor = working.lowestValidUsn > working.firstUsn ? working.lowestValidUsn : working.firstUsn
    ring = []
    let deleted = false
    let ioctlFailed = false
    for (let i = 0; i < 120; i++) {
      const batch = readUsnJournal(h, working.journalId, start)
      if (!batch) break
      if (batch.err === WINERR_JOURNAL_ENTRY_DELETED) {
        deleted = true
        lastErr = batch.err
        break
      }
      if (batch.err && batch.entries.length === 0) {
        lastErr = batch.err
        ioctlFailed = true
        break
      }
      if (batch.entries.length === 0) break
      for (const e of batch.entries) {
        ring.push({
          usn: e.usn.toString(),
          name: e.name,
          isDir: e.isDir,
          reason: e.reason,
          timeMs: e.timeMs
        })
      }
      if (ring.length > cap) ring.splice(0, ring.length - cap)
      if (batch.nextUsn <= start) break
      start = batch.nextUsn
    }
    if (ioctlFailed) break
    if (deleted) {
      const again = queryUsnJournal(h)
      if (again) working = again
      lookback *= 2n
      continue
    }
    if (ring.length >= cap || startedAt <= floor || lookback >= maxLook) break
    lookback *= 2n
  }
  ring.reverse()
  return { entries: ring.slice(0, cap), err: lastErr }
}
