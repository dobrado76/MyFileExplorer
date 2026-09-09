/**
 * Main-process sequential script queue. Session-only; one active spawn at a time.
 */
import { randomUUID } from 'node:crypto'
import { AppError } from '@shared/result'
import type { ScriptRunRequest } from '@shared/schemas/scripts'
import {
  beginNextScriptQueueJob,
  clearScriptQueuePending,
  emptyScriptQueue,
  enqueueScriptQueueJob,
  finishScriptQueueRun,
  newScriptQueueJobId,
  removeScriptQueueJob,
  reorderScriptQueuePending,
  scriptQueueActive,
  scriptQueuePendingCount,
  updateScriptQueueJobRequest,
  type ScriptQueueJob,
  type ScriptQueueState
} from '@shared/scriptRunQueue'
import { broadcast } from '../ipc/events'
import { assertScriptingEnabled, cancelScriptRun, executeScriptRun } from './execute'
import { getScript } from './library'

let state: ScriptQueueState = emptyScriptQueue()
let pumpRunning = false

function snapshotJobs(): ScriptQueueJob[] {
  return state.jobs.map((j) => ({
    ...j,
    request: { ...j.request }
  }))
}

function broadcastQueue(): void {
  broadcast({
    type: 'script-queue',
    payload: { jobs: snapshotJobs() }
  })
}

function labelForRequest(req: Omit<ScriptRunRequest, 'runId'> & { runId?: string }, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim()
  if (req.scriptId) {
    try {
      return getScript(req.scriptId).name
    } catch {
      return req.scriptId
    }
  }
  return 'Ad-hoc script'
}

async function pump(): Promise<void> {
  if (pumpRunning) return
  pumpRunning = true
  try {
    for (;;) {
      if (scriptQueueActive(state)) return
      const runId = randomUUID()
      const began = beginNextScriptQueueJob(state, runId)
      if (!began.ok) return
      state = began.state
      broadcastQueue()
      const job = began.job
      try {
        await executeScriptRun(job.request)
      } catch {
        // Spawn/validation failure — script-ended may not have fired.
        broadcast({
          type: 'script-ended',
          payload: {
            runId,
            exitCode: null,
            cancelled: false,
            elapsedMs: 0,
            dryRun: job.request.dryRun === true
          }
        })
      }
      state = finishScriptQueueRun(state, runId)
      broadcastQueue()
    }
  } finally {
    pumpRunning = false
  }
}

export function listScriptQueue(): { jobs: ScriptQueueJob[] } {
  return { jobs: snapshotJobs() }
}

export function enqueueScriptJob(input: {
  label?: string
  request: Omit<ScriptRunRequest, 'runId'> & { runId?: string }
}): {
  jobId: string
  started: boolean
  queuePosition: number
  jobs: ScriptQueueJob[]
} {
  assertScriptingEnabled()
  const hadActive = Boolean(scriptQueueActive(state))
  const jobId = newScriptQueueJobId()
  const placeholderRunId = input.request.runId?.trim() || `pending_${jobId}`
  const request: ScriptRunRequest = {
    ...input.request,
    runId: placeholderRunId
  }
  const enq = enqueueScriptQueueJob(state, {
    jobId,
    label: labelForRequest(request, input.label),
    enqueuedAt: Date.now(),
    request
  })
  if (!enq.ok) throw new AppError('busy', enq.error)
  state = enq.state
  const pending = scriptQueuePendingCount(state)
  broadcastQueue()
  void pump()
  return {
    jobId,
    started: !hadActive,
    queuePosition: hadActive ? pending : 1,
    jobs: snapshotJobs()
  }
}

export function reorderScriptQueue(pendingJobIds: string[]): { jobs: ScriptQueueJob[] } {
  assertScriptingEnabled()
  const res = reorderScriptQueuePending(state, pendingJobIds)
  if (!res.ok) throw new AppError('validation', res.error)
  state = res.state
  broadcastQueue()
  return { jobs: snapshotJobs() }
}

export function removeScriptQueueJobById(jobId: string): { jobs: ScriptQueueJob[]; cancelled: boolean } {
  assertScriptingEnabled()
  const res = removeScriptQueueJob(state, jobId)
  let cancelled = false
  if (res.wasRunning && res.removed?.runId) {
    cancelScriptRun(res.removed.runId)
    cancelled = true
    // finish happens on script-ended / pump; still drop from list now if cancel is sync enough
    state = res.state
  } else {
    state = res.state
  }
  broadcastQueue()
  if (!res.wasRunning) void pump()
  return { jobs: snapshotJobs(), cancelled }
}

export function clearScriptQueue(opts?: { stopActive?: boolean }): { jobs: ScriptQueueJob[] } {
  assertScriptingEnabled()
  const active = scriptQueueActive(state)
  if (opts?.stopActive === true && active?.runId) {
    cancelScriptRun(active.runId)
    state = emptyScriptQueue()
  } else {
    state = clearScriptQueuePending(state)
  }
  broadcastQueue()
  void pump()
  return { jobs: snapshotJobs() }
}

export function updateScriptQueueJob(
  jobId: string,
  patch: { params?: ScriptRunRequest['params']; recursive?: boolean; dryRun?: boolean }
): { jobs: ScriptQueueJob[] } {
  assertScriptingEnabled()
  const res = updateScriptQueueJobRequest(state, jobId, patch)
  if (!res.ok) throw new AppError('validation', res.error)
  state = res.state
  broadcastQueue()
  return { jobs: snapshotJobs() }
}

/** On process exit path already handled in pump; expose for tests / reset. */
export function resetScriptQueueForTests(): void {
  state = emptyScriptQueue()
  pumpRunning = false
}
