import { broadcast } from '../ipc/events'
import type { MfeEvent } from '@shared/ipc/contract'

export type FileOpKind = NonNullable<
  Extract<MfeEvent, { type: 'op-progress' }>['payload']['kind']
>

export type OpReporter = {
  opId: string
  tick(current?: string): void
  /** Advance by multiple work units (e.g. same-volume folder rename). */
  advance(n: number, current?: string): void
  setDone(done: number, current?: string): void
  finish(): void
  fail(): void
}

let seq = 0

/**
 * Broadcast progress for a multi-file (or large-tree) filesystem operation.
 * Always call `finish()` or `fail()` in a finally block.
 */
export function beginOp(kind: FileOpKind, total: number, label?: string): OpReporter {
  const opId = `${kind}-${Date.now()}-${++seq}`
  const safeTotal = Math.max(0, total)
  let done = 0
  let lastEmitMs = 0
  let pendingCurrent: string | undefined

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
        phase
      }
    })
  }

  emit('running', undefined, true)

  return {
    opId,
    tick(current) {
      done = Math.min(done + 1, Math.max(safeTotal, done + 1))
      emit('running', current, done >= safeTotal)
    },
    advance(n, current) {
      done = Math.min(done + Math.max(0, n), Math.max(safeTotal, done + Math.max(0, n)))
      emit('running', current, true)
    },
    setDone(next, current) {
      done = Math.max(0, next)
      emit('running', current, true)
    },
    finish() {
      done = Math.max(done, safeTotal)
      emit('done', undefined, true)
    },
    fail() {
      emit('done', undefined, true)
    }
  }
}
