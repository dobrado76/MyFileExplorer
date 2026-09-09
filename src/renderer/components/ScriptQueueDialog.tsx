import { useCallback, type JSX } from 'react'
import type { ScriptQueueJob } from '@shared/scriptRunQueue'
import { useAppStore } from '../store/appStore'
import { ScriptModal, api, call, formatError } from './scriptUi'

export function ScriptQueueDialog(): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const notify = useAppStore((s) => s.notify)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const settings = useAppStore((s) => s.settings)
  const scriptQueue = useAppStore((s) => s.scriptQueue)
  const expandScriptRunner = useAppStore((s) => s.expandScriptRunner)

  const persistBounds = useCallback(
    (next: { x: number; y: number; width: number; height: number }, _m: boolean) => {
      void applySettingsPatch({ scriptQueueBounds: next })
    },
    [applySettingsPatch]
  )

  const active = scriptQueue.find((j) => j.status === 'running') ?? null
  const pending = scriptQueue.filter((j) => j.status === 'pending')

  const refreshErr = (e: unknown): void => {
    notify(formatError(e), true)
  }

  const move = async (jobId: string, dir: -1 | 1): Promise<void> => {
    const ids = pending.map((j) => j.jobId)
    const i = ids.indexOf(jobId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    const next = ids.slice()
    const tmp = next[i]!
    next[i] = next[j]!
    next[j] = tmp
    try {
      await call(api.script.queueReorder({ pendingJobIds: next }))
    } catch (e) {
      refreshErr(e)
    }
  }

  const remove = async (job: ScriptQueueJob): Promise<void> => {
    try {
      await call(api.script.queueRemove({ jobId: job.jobId }))
      if (job.status === 'running') notify('Stopping active script…')
    } catch (e) {
      refreshErr(e)
    }
  }

  const clearPending = async (): Promise<void> => {
    try {
      await call(api.script.queueClear({}))
    } catch (e) {
      refreshErr(e)
    }
  }

  const edit = (job: ScriptQueueJob): void => {
    const r = job.request
    openDialog({
      kind: 'script-run',
      scriptId: r.scriptId,
      source: r.source,
      language: r.language,
      name: job.label,
      mode: r.mode,
      root: r.root,
      paths: r.paths,
      recursive: r.recursive,
      dryRun: r.dryRun,
      editJobId: job.jobId,
      params: r.params
    })
  }

  return (
    <ScriptModal
      className="modal-script-queue"
      title="Script queue"
      titleHint="Sequential runs — one at a time. Session-only (cleared on quit)."
      floating={{
        saved: settings.scriptQueueBounds,
        persist: persistBounds,
        minW: 420,
        minH: 320,
        defaultW: 560,
        defaultH: 480
      }}
      onClose={closeDialog}
      actions={
        <>
          <button
            type="button"
            className="btn"
            title="Remove all pending jobs. The active run is not stopped."
            disabled={pending.length === 0}
            onClick={() => void clearPending()}
          >
            Clear pending
          </button>
          <button type="button" className="btn" onClick={closeDialog}>
            Close
          </button>
        </>
      }
    >
      {scriptQueue.length === 0 ? (
        <p className="script-queue-empty">No scripts running or queued.</p>
      ) : (
        <ul className="script-queue-list">
          {active ? (
            <li className="script-queue-row is-active">
              <div className="script-queue-main">
                <span className="script-queue-badge">Running</span>
                <span className="script-queue-label" title={active.label}>
                  {active.label}
                </span>
                {active.request.dryRun ? (
                  <span className="script-queue-dry">dry-run</span>
                ) : null}
              </div>
              <div className="script-queue-actions">
                <button
                  type="button"
                  className="btn"
                  title="Show the live output window"
                  onClick={() => expandScriptRunner()}
                >
                  Expand
                </button>
                <button
                  type="button"
                  className="btn danger"
                  title="Stop this run and start the next pending job"
                  onClick={() => void remove(active)}
                >
                  Stop
                </button>
              </div>
            </li>
          ) : null}
          {pending.map((job, index) => (
            <li key={job.jobId} className="script-queue-row">
              <div className="script-queue-main">
                <span className="script-queue-badge">#{index + 1}</span>
                <span className="script-queue-label" title={job.label}>
                  {job.label}
                </span>
                {job.request.dryRun ? (
                  <span className="script-queue-dry">dry-run</span>
                ) : null}
              </div>
              <div className="script-queue-actions">
                <button
                  type="button"
                  className="btn"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => void move(job.jobId, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  title="Move down"
                  disabled={index === pending.length - 1}
                  onClick={() => void move(job.jobId, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn"
                  title="Edit params / Recursive / Dry-run for this pending job"
                  onClick={() => edit(job)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn danger"
                  title="Remove from queue"
                  onClick={() => void remove(job)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ScriptModal>
  )
}
