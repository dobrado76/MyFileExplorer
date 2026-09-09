/**
 * Pure in-session script run queue (FIFO, one active).
 * Main owns spawning; this module only manages job list state.
 */
import type { ScriptRunRequest } from './schemas/scripts'

export const SCRIPT_QUEUE_MAX_PENDING = 50

export type ScriptQueueJobStatus = 'pending' | 'running'

export type ScriptQueueJob = {
  jobId: string
  /** Set when the job becomes running. */
  runId: string | null
  label: string
  enqueuedAt: number
  status: ScriptQueueJobStatus
  request: ScriptRunRequest
}

export type ScriptQueueState = {
  jobs: ScriptQueueJob[]
}

export function emptyScriptQueue(): ScriptQueueState {
  return { jobs: [] }
}

export function scriptQueuePendingCount(state: ScriptQueueState): number {
  return state.jobs.filter((j) => j.status === 'pending').length
}

export function scriptQueueActive(state: ScriptQueueState): ScriptQueueJob | null {
  return state.jobs.find((j) => j.status === 'running') ?? null
}

export function enqueueScriptQueueJob(
  state: ScriptQueueState,
  job: Omit<ScriptQueueJob, 'status' | 'runId'> & { runId?: string | null }
): { ok: true; state: ScriptQueueState } | { ok: false; error: string } {
  if (scriptQueuePendingCount(state) >= SCRIPT_QUEUE_MAX_PENDING) {
    return {
      ok: false,
      error: `Script queue is full (max ${SCRIPT_QUEUE_MAX_PENDING} pending)`
    }
  }
  if (state.jobs.some((j) => j.jobId === job.jobId)) {
    return { ok: false, error: 'Duplicate job id' }
  }
  const next: ScriptQueueJob = {
    jobId: job.jobId,
    runId: null,
    label: job.label,
    enqueuedAt: job.enqueuedAt,
    status: 'pending',
    request: job.request
  }
  return { ok: true, state: { jobs: [...state.jobs, next] } }
}

/** Reorder pending jobs; running job stays first if present. `pendingJobIds` is the new pending order. */
export function reorderScriptQueuePending(
  state: ScriptQueueState,
  pendingJobIds: string[]
): { ok: true; state: ScriptQueueState } | { ok: false; error: string } {
  const running = state.jobs.filter((j) => j.status === 'running')
  const pending = state.jobs.filter((j) => j.status === 'pending')
  if (pendingJobIds.length !== pending.length) {
    return { ok: false, error: 'Reorder must include every pending job exactly once' }
  }
  const byId = new Map(pending.map((j) => [j.jobId, j]))
  const nextPending: ScriptQueueJob[] = []
  const seen = new Set<string>()
  for (const id of pendingJobIds) {
    if (seen.has(id)) return { ok: false, error: 'Duplicate job in reorder' }
    const job = byId.get(id)
    if (!job) return { ok: false, error: `Unknown pending job ${id}` }
    seen.add(id)
    nextPending.push(job)
  }
  return { ok: true, state: { jobs: [...running, ...nextPending] } }
}

export function removeScriptQueueJob(
  state: ScriptQueueState,
  jobId: string
): {
  ok: true
  state: ScriptQueueState
  removed: ScriptQueueJob | null
  wasRunning: boolean
} {
  const job = state.jobs.find((j) => j.jobId === jobId) ?? null
  if (!job) return { ok: true, state, removed: null, wasRunning: false }
  return {
    ok: true,
    state: { jobs: state.jobs.filter((j) => j.jobId !== jobId) },
    removed: job,
    wasRunning: job.status === 'running'
  }
}

export function clearScriptQueuePending(state: ScriptQueueState): ScriptQueueState {
  return { jobs: state.jobs.filter((j) => j.status === 'running') }
}

export function updateScriptQueueJobRequest(
  state: ScriptQueueState,
  jobId: string,
  patch: Partial<Pick<ScriptRunRequest, 'params' | 'recursive' | 'dryRun' | 'root' | 'paths'>>
): { ok: true; state: ScriptQueueState } | { ok: false; error: string } {
  const idx = state.jobs.findIndex((j) => j.jobId === jobId)
  if (idx < 0) return { ok: false, error: 'Job not found' }
  const job = state.jobs[idx]!
  if (job.status !== 'pending') return { ok: false, error: 'Only pending jobs can be edited' }
  const jobs = state.jobs.slice()
  jobs[idx] = {
    ...job,
    request: {
      ...job.request,
      ...patch
    }
  }
  return { ok: true, state: { jobs } }
}

/** Promote the first pending job to running with `runId`. */
export function beginNextScriptQueueJob(
  state: ScriptQueueState,
  runId: string
): { ok: true; state: ScriptQueueState; job: ScriptQueueJob } | { ok: false } {
  if (scriptQueueActive(state)) return { ok: false }
  const idx = state.jobs.findIndex((j) => j.status === 'pending')
  if (idx < 0) return { ok: false }
  const job = state.jobs[idx]!
  const next: ScriptQueueJob = {
    ...job,
    status: 'running',
    runId,
    request: { ...job.request, runId }
  }
  const jobs = state.jobs.slice()
  jobs[idx] = next
  return { ok: true, state: { jobs }, job: next }
}

export function finishScriptQueueRun(
  state: ScriptQueueState,
  runId: string
): ScriptQueueState {
  return {
    jobs: state.jobs.filter((j) => !(j.status === 'running' && j.runId === runId))
  }
}

export function newScriptQueueJobId(): string {
  return `qj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
