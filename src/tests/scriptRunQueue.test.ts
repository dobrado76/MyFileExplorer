import { describe, expect, it } from 'vitest'
import {
  beginNextScriptQueueJob,
  clearScriptQueuePending,
  emptyScriptQueue,
  enqueueScriptQueueJob,
  finishScriptQueueRun,
  removeScriptQueueJob,
  reorderScriptQueuePending,
  SCRIPT_QUEUE_MAX_PENDING,
  scriptQueueActive,
  scriptQueuePendingCount,
  updateScriptQueueJobRequest,
  type ScriptQueueJob
} from '@shared/scriptRunQueue'
import type { ScriptRunRequest } from '@shared/schemas/scripts'

function req(runId = 'r1'): ScriptRunRequest {
  return {
    runId,
    mode: 'folder',
    root: 'C:\\tmp',
    language: 'powershell',
    source: 'Write-Host hi'
  }
}

function pending(jobId: string, label = jobId): Omit<ScriptQueueJob, 'status' | 'runId'> {
  return {
    jobId,
    label,
    enqueuedAt: Date.now(),
    request: req(`pending_${jobId}`)
  }
}

describe('scriptRunQueue', () => {
  it('enqueues and counts pending', () => {
    let state = emptyScriptQueue()
    const a = enqueueScriptQueueJob(state, pending('a'))
    expect(a.ok).toBe(true)
    if (!a.ok) return
    state = a.state
    const b = enqueueScriptQueueJob(state, pending('b'))
    expect(b.ok).toBe(true)
    if (!b.ok) return
    state = b.state
    expect(scriptQueuePendingCount(state)).toBe(2)
    expect(scriptQueueActive(state)).toBeNull()
  })

  it('begins next and finishes', () => {
    const enq = enqueueScriptQueueJob(emptyScriptQueue(), pending('a'))
    expect(enq.ok).toBe(true)
    if (!enq.ok) return
    let state = enq.state
    const began = beginNextScriptQueueJob(state, 'run-1')
    expect(began.ok).toBe(true)
    if (!began.ok) return
    state = began.state
    expect(scriptQueueActive(state)?.runId).toBe('run-1')
    expect(scriptQueuePendingCount(state)).toBe(0)
    state = finishScriptQueueRun(state, 'run-1')
    expect(scriptQueueActive(state)).toBeNull()
    expect(state.jobs).toHaveLength(0)
  })

  it('reorders pending only', () => {
    let state = emptyScriptQueue()
    for (const id of ['a', 'b', 'c']) {
      const r = enqueueScriptQueueJob(state, pending(id))
      expect(r.ok).toBe(true)
      if (r.ok) state = r.state
    }
    const began = beginNextScriptQueueJob(state, 'run-a')
    expect(began.ok).toBe(true)
    if (!began.ok) return
    state = began.state
    const re = reorderScriptQueuePending(state, ['c', 'b'])
    expect(re.ok).toBe(true)
    if (!re.ok) return
    state = re.state
    expect(state.jobs.map((j) => j.jobId)).toEqual(['a', 'c', 'b'])
    expect(state.jobs[0]?.status).toBe('running')
  })

  it('removes pending and clears pending', () => {
    let state = emptyScriptQueue()
    for (const id of ['a', 'b']) {
      const r = enqueueScriptQueueJob(state, pending(id))
      if (r.ok) state = r.state
    }
    const began = beginNextScriptQueueJob(state, 'run-a')
    if (began.ok) state = began.state
    const rem = removeScriptQueueJob(state, 'b')
    state = rem.state
    expect(scriptQueuePendingCount(state)).toBe(0)
    const enq = enqueueScriptQueueJob(state, pending('c'))
    if (enq.ok) state = enq.state
    state = clearScriptQueuePending(state)
    expect(scriptQueuePendingCount(state)).toBe(0)
    expect(scriptQueueActive(state)?.jobId).toBe('a')
  })

  it('updates pending params only', () => {
    let state = emptyScriptQueue()
    const enq = enqueueScriptQueueJob(state, pending('a'))
    if (!enq.ok) return
    state = enq.state
    const up = updateScriptQueueJobRequest(state, 'a', { dryRun: true, recursive: true })
    expect(up.ok).toBe(true)
    if (!up.ok) return
    expect(up.state.jobs[0]?.request.dryRun).toBe(true)
    expect(up.state.jobs[0]?.request.recursive).toBe(true)
    const began = beginNextScriptQueueJob(up.state, 'run-1')
    if (!began.ok) return
    const bad = updateScriptQueueJobRequest(began.state, 'a', { dryRun: false })
    expect(bad.ok).toBe(false)
  })

  it('rejects when pending is full', () => {
    let state = emptyScriptQueue()
    for (let i = 0; i < SCRIPT_QUEUE_MAX_PENDING; i++) {
      const r = enqueueScriptQueueJob(state, pending(`j${i}`))
      expect(r.ok).toBe(true)
      if (r.ok) state = r.state
    }
    const overflow = enqueueScriptQueueJob(state, pending('overflow'))
    expect(overflow.ok).toBe(false)
  })
})
