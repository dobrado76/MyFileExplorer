import { broadcast } from '../ipc/events'
import type { MfeEvent } from '@shared/ipc/contract'
import { AppError } from '@shared/result'

export type FileOpKind = NonNullable<
  Extract<MfeEvent, { type: 'op-progress' }>['payload']['kind']
>

export type OpReporter = {
  opId: string
  /** Throws AppError(cancelled) when the user hit Cancel. */
  throwIfCancelled(): void
  isCancelled(): boolean
  tick(current?: string): void
  /** Advance by multiple work units (e.g. same-volume folder rename). */
  advance(n: number, current?: string): void
  setDone(done: number, current?: string): void
  /** Update total after a counting/scan pass (0 = indeterminate). */
  setTotal(total: number, current?: string): void
  /** Discover more files (folder listing) before they are copied. */
  addToTotal(n: number, current?: string): void
  /** Re-emit current counters (keep UI alive during a long single rename/copy). */
  pulse(current?: string): void
  /** Byte progress for a large file currently being copied. */
  reportBytes(done: number, total: number, current?: string): void
  finish(): void
  fail(): void
}

type OpToken = { cancelled: boolean }

const activeOps = new Map<string, OpToken>()

/** Mark every in-flight file op as cancelled (status-bar Cancel). */
export function requestCancelActiveOps(): { cancelled: boolean; opIds: string[] } {
  const opIds = [...activeOps.keys()]
  for (const token of activeOps.values()) token.cancelled = true
  return { cancelled: opIds.length > 0, opIds }
}

export function cancelledError(): AppError {
  return new AppError('cancelled', 'Cancelled')
}

let seq = 0

/**
 * Broadcast progress for a multi-file (or large-tree) filesystem operation.
 * Always call `finish()` or `fail()` in a finally block.
 */
export function beginOp(kind: FileOpKind, total: number, label?: string): OpReporter {
  const opId = `${kind}-${Date.now()}-${++seq}`
  let safeTotal = Math.max(0, total)
  let done = 0
  let lastEmitMs = 0
  let pendingCurrent: string | undefined
  let bytesDone: number | undefined
  let bytesTotal: number | undefined
  const token: OpToken = { cancelled: false }
  activeOps.set(opId, token)

  const throwIfCancelled = (): void => {
    if (token.cancelled) throw cancelledError()
  }

  const emit = (phase: 'running' | 'done', current?: string, force = false): void => {
    const now = Date.now()
    if (
      !force &&
      phase === 'running' &&
      done > 0 &&
      done < safeTotal &&
      now - lastEmitMs < 50
    ) {
      pendingCurrent = current ?? pendingCurrent
      return
    }
    lastEmitMs = now
    const shown = current ?? pendingCurrent
    pendingCurrent = undefined
    broadcast({
      type: 'op-progress',
      payload: {
        opId,
        kind,
        done,
        total: safeTotal,
        current: shown,
        label,
        bytesDone,
        bytesTotal,
        phase
      }
    })
  }

  emit('running', undefined, true)

  const end = (phase: 'done'): void => {
    activeOps.delete(opId)
    emit(phase, undefined, true)
  }

  return {
    opId,
    throwIfCancelled,
    isCancelled: () => token.cancelled,
    tick(current) {
      throwIfCancelled()
      bytesDone = undefined
      bytesTotal = undefined
      done += 1
      if (safeTotal > 0 && done > safeTotal) safeTotal = done
      emit('running', current, safeTotal > 0 && done >= safeTotal)
    },
    advance(n, current) {
      throwIfCancelled()
      bytesDone = undefined
      bytesTotal = undefined
      done += Math.max(0, n)
      if (safeTotal > 0 && done > safeTotal) safeTotal = done
      emit('running', current, true)
    },
    setDone(next, current) {
      throwIfCancelled()
      done = Math.max(0, next)
      emit('running', current, true)
    },
    setTotal(next, current) {
      throwIfCancelled()
      safeTotal = Math.max(0, next)
      emit('running', current, true)
    },
    addToTotal(n, current) {
      throwIfCancelled()
      safeTotal += Math.max(0, n)
      emit('running', current, true)
    },
    pulse(current) {
      // Heartbeat timers call pulse between async work — must not throw uncaught on cancel.
      if (token.cancelled) return
      emit('running', current, true)
    },
    reportBytes(bDone, bTotal, current) {
      throwIfCancelled()
      bytesDone = Math.max(0, bDone)
      bytesTotal = Math.max(0, bTotal)
      const now = Date.now()
      if (now - lastEmitMs < 100 && bDone < bTotal) {
        pendingCurrent = current ?? pendingCurrent
        return
      }
      emit('running', current, true)
    },
    finish() {
      bytesDone = undefined
      bytesTotal = undefined
      done = Math.max(done, safeTotal)
      end('done')
    },
    fail() {
      end('done')
    }
  }
}
