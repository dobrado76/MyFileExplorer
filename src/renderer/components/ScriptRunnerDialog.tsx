import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { ScriptDefinition, ScriptLanguage, ScriptRunMode } from '@shared/schemas/scripts'
import { useAppStore } from '../store/appStore'
import {
  CopyInstall,
  DestructiveBanner,
  ParamsForm,
  RiskBanner,
  ScriptModal,
  formatError,
  api,
  call
} from './scriptUi'

export function ScriptRunnerDialog(props: {
  scriptId?: string
  source?: string
  language?: ScriptLanguage
  name?: string
  mode: ScriptRunMode
  root?: string
  paths?: string[]
  recursive?: boolean
  dryRun?: boolean
  editJobId?: string
  params?: Record<string, string | number | boolean>
}): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const notify = useAppStore((s) => s.notify)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const settings = useAppStore((s) => s.settings)
  const minimizeScriptRunner = useAppStore((s) => s.minimizeScriptRunner)
  const clearScriptRunnerUi = useAppStore((s) => s.clearScriptRunnerUi)
  const scriptRunnerUi = useAppStore((s) => s.scriptRunnerUi)
  const scriptQueue = useAppStore((s) => s.scriptQueue)
  const persistRunnerBounds = useCallback(
    (next: { x: number; y: number; width: number; height: number }, _maximized: boolean) => {
      void applySettingsPatch({ scriptRunnerBounds: next })
    },
    [applySettingsPatch]
  )

  const [script, setScript] = useState<ScriptDefinition | null>(null)
  const [source, setSource] = useState(props.source ?? '')
  const [language, setLanguage] = useState<ScriptLanguage>(props.language ?? 'powershell')
  const [params, setParams] = useState<Record<string, string | number | boolean>>(
    props.params ?? {}
  )
  const [recursive, setRecursive] = useState(props.recursive ?? false)
  const [output, setOutput] = useState(() =>
    scriptRunnerUi && !scriptRunnerUi.minimized ? scriptRunnerUi.output : ''
  )
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>(() =>
    scriptRunnerUi && scriptRunnerUi.runId ? scriptRunnerUi.status : 'idle'
  )
  const [exitCode, setExitCode] = useState<number | null>(
    () => scriptRunnerUi?.exitCode ?? null
  )
  const [startedAt, setStartedAt] = useState<number | null>(
    () => scriptRunnerUi?.startedAt ?? null
  )
  const [elapsed, setElapsed] = useState('0.0s')
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmFix, setConfirmFix] = useState(false)
  const [redactPaths, setRedactPaths] = useState(true)
  const [jobId, setJobId] = useState<string | null>(
    () => props.editJobId ?? scriptRunnerUi?.jobId ?? null
  )
  const runIdRef = useRef<string | null>(scriptRunnerUi?.runId ?? null)
  const stderrRef = useRef('')
  const outputRef = useRef<HTMLPreElement>(null)
  const stickToBottomRef = useRef(true)
  const editing = Boolean(props.editJobId)

  useEffect(() => {
    if (!props.scriptId) return
    void (async () => {
      try {
        const res = await call(api.script.get({ id: props.scriptId! }))
        setScript(res.script)
        setSource(res.source)
        setLanguage(res.script.language)
        setRecursive(props.recursive ?? res.script.recursive)
        if (!props.params) {
          const initial: Record<string, string | number | boolean> = {}
          for (const p of res.script.parameters) {
            if (p.defaultValue !== undefined) initial[p.name] = p.defaultValue
          }
          setParams(initial)
        }
      } catch (e) {
        setError(formatError(e))
      }
    })()
  }, [props.scriptId, props.recursive, props.params])

  // Sync from store when minimized runner streams / ends in background then we expand.
  useEffect(() => {
    if (!scriptRunnerUi || scriptRunnerUi.minimized) return
    if (scriptRunnerUi.jobId && scriptRunnerUi.jobId === jobId) {
      setOutput(scriptRunnerUi.output)
      setStatus(scriptRunnerUi.status)
      setExitCode(scriptRunnerUi.exitCode)
      if (scriptRunnerUi.runId) runIdRef.current = scriptRunnerUi.runId
      if (scriptRunnerUi.startedAt) setStartedAt(scriptRunnerUi.startedAt)
    }
  }, [scriptRunnerUi, jobId])

  // Pick up runId when our queued job starts.
  useEffect(() => {
    if (!jobId) return
    const job = scriptQueue.find((j) => j.jobId === jobId)
    if (job?.status === 'running' && job.runId) {
      runIdRef.current = job.runId
      setStatus('running')
      setStartedAt((t) => t ?? Date.now())
      setBusy(true)
    }
  }, [scriptQueue, jobId])

  useEffect(() => {
    const unsub = api.onEvent((ev) => {
      const id = runIdRef.current
      if (!id) return
      if (ev.type === 'script-output' && ev.payload.runId === id) {
        setOutput((o) => o + ev.payload.text)
        if (ev.payload.stream === 'stderr') stderrRef.current += ev.payload.text
      }
      if (ev.type === 'script-ended' && ev.payload.runId === id) {
        setStatus('done')
        setExitCode(ev.payload.exitCode)
        setElapsed(`${(ev.payload.elapsedMs / 1000).toFixed(1)}s`)
        setBusy(false)
      }
    })
    return unsub
  }, [])

  useLayoutEffect(() => {
    const el = outputRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [output])

  const onOutputScroll = (): void => {
    const el = outputRef.current
    if (!el) return
    const distFromEnd = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distFromEnd <= 24
  }

  useEffect(() => {
    if (status !== 'running' || !startedAt) return
    const t = setInterval(() => {
      setElapsed(`${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
    }, 250)
    return () => clearInterval(t)
  }, [status, startedAt])

  const dialogSnapshot = useCallback(
    () =>
      ({
        kind: 'script-run' as const,
        scriptId: props.scriptId,
        source: props.scriptId ? undefined : source,
        language: props.scriptId ? undefined : language,
        name: props.name,
        mode: props.mode,
        root: props.root,
        paths: props.paths,
        recursive,
        dryRun: props.dryRun,
        editJobId: props.editJobId,
        params
      }) as const,
    [
      language,
      params,
      props.dryRun,
      props.editJobId,
      props.mode,
      props.name,
      props.paths,
      props.root,
      props.scriptId,
      recursive,
      source
    ]
  )

  const start = useCallback(
    async (dryRun: boolean) => {
      if (!settings.scripts.acknowledgedRisk) {
        setError('Acknowledge the first-run warning before running a script.')
        return
      }
      if (editing && props.editJobId) {
        setBusy(true)
        setError(null)
        try {
          await call(
            api.script.queueUpdate({
              jobId: props.editJobId,
              params,
              recursive,
              dryRun
            })
          )
          notify('Queue job updated')
          closeDialog()
          openDialog({ kind: 'script-queue' })
        } catch (e) {
          setError(formatError(e))
        } finally {
          setBusy(false)
        }
        return
      }
      setError(null)
      setOutput('')
      stderrRef.current = ''
      stickToBottomRef.current = true
      setExitCode(null)
      setBusy(true)
      try {
        const res = await call(
          api.script.queueEnqueue({
            label: props.name || script?.name,
            request: {
              scriptId: props.scriptId,
              source: props.scriptId ? undefined : source,
              language: props.scriptId ? undefined : language,
              mode: props.mode,
              root: props.root,
              paths: props.paths,
              recursive,
              dryRun,
              params
            }
          })
        )
        setJobId(res.jobId)
        useAppStore.setState({
          scriptRunnerUi: {
            minimized: false,
            jobId: res.jobId,
            runId: null,
            label: props.name || script?.name || 'Script',
            output: '',
            status: res.started ? 'running' : 'idle',
            exitCode: null,
            startedAt: res.started ? Date.now() : null,
            dryRun,
            dialog: dialogSnapshot()
          }
        })
        if (res.started) {
          setStatus('running')
          setStartedAt(Date.now())
          const job = res.jobs.find((j) => j.jobId === res.jobId)
          if (job?.runId) runIdRef.current = job.runId
        } else {
          setBusy(false)
          setStatus('idle')
          notify(`Queued (#${res.queuePosition})`)
          closeDialog()
          openDialog({ kind: 'script-queue' })
        }
      } catch (e) {
        setError(formatError(e))
        setStatus('done')
        setBusy(false)
      }
    },
    [
      closeDialog,
      dialogSnapshot,
      editing,
      language,
      notify,
      openDialog,
      params,
      props.editJobId,
      props.mode,
      props.name,
      props.paths,
      props.root,
      props.scriptId,
      recursive,
      script,
      settings.scripts.acknowledgedRisk,
      source
    ]
  )

  const stop = (): void => {
    if (runIdRef.current) void call(api.script.cancel({ runId: runIdRef.current })).catch(() => {})
  }

  const minimize = (): void => {
    minimizeScriptRunner({
      jobId,
      runId: runIdRef.current,
      label: props.name || script?.name || 'Script',
      output,
      status,
      exitCode,
      startedAt,
      dryRun: props.dryRun === true || scriptRunnerUi?.dryRun === true,
      dialog: dialogSnapshot()
    })
  }

  const onClose = (): void => {
    if (aiBusy) return
    if (status === 'running') {
      const go = window.confirm(
        'A script is still running. Stop it and close?\n\nUse Minimize to keep it running in the status bar.'
      )
      if (!go) return
      stop()
    }
    clearScriptRunnerUi()
    closeDialog()
  }

  const title = props.name || script?.name || (editing ? 'Edit queued job' : 'Run script')
  const dryOk = script?.dryRunSupported ?? /--dry-run/.test(source)
  const deps = script?.dependencies ?? []

  return (
    <ScriptModal
      className="modal-script-run"
      title={title}
      busy={aiBusy}
      busyTitle="Asking AI to fix…"
      busyHint="This may take some time."
      floating={{
        saved: settings.scriptRunnerBounds,
        persist: persistRunnerBounds,
        minW: 480,
        minH: 360,
        defaultW: 760,
        defaultH: 640
      }}
      onClose={onClose}
      onMinimize={status === 'running' || status === 'done' ? minimize : undefined}
      actions={
        <>
          <button
            type="button"
            className="btn"
            title="Copy stdout/stderr from this run to the clipboard."
            onClick={() => void navigator.clipboard.writeText(output)}
          >
            Copy output
          </button>
          {status === 'running' ? (
            <button
              type="button"
              className="btn danger"
              title="Kill the running process. Partial file changes already made are not undone."
              onClick={stop}
            >
              Stop
            </button>
          ) : editing ? (
            <button
              type="button"
              className="btn primary"
              title="Save params for this pending queue job."
              disabled={busy}
              onClick={() => void start(props.dryRun === true)}
            >
              Update queue
            </button>
          ) : (
            <>
              {dryOk && (
                <button
                  type="button"
                  className="btn"
                  title="Enqueue with --dry-run so the script can preview without writing."
                  disabled={busy}
                  onClick={() => void start(true)}
                >
                  Dry run
                </button>
              )}
              <button
                type="button"
                className="btn primary"
                title="Enqueue to run as your Windows user (sequential queue)."
                disabled={busy}
                onClick={() => void start(false)}
              >
                Run
              </button>
            </>
          )}
          <button
            type="button"
            className="btn"
            title={
              status === 'running'
                ? 'Stop the script and close. Prefer Minimize to keep running.'
                : 'Close this run window.'
            }
            disabled={aiBusy}
            onClick={onClose}
          >
            Close
          </button>
        </>
      }
    >
      <RiskBanner />
      <DestructiveBanner source={source} flagged={!!script?.destructive} />
      <CopyInstall language={language} deps={deps} />
      {script?.parameters && script.parameters.length > 0 && (
        <ParamsForm parameters={script.parameters} values={params} onChange={setParams} />
      )}
      {props.mode !== 'global' && (script?.scopes.includes('folder') || props.mode === 'folder') && (
        <label
          className="settings-toggle"
          title="Pass --recursive so the script walks subfolders of the current folder."
        >
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
            disabled={status === 'running'}
          />
          <span className="settings-toggle-text">
            <span className="settings-toggle-label">Recursive</span>
          </span>
        </label>
      )}
      <div className="script-run-meta">
        Status: {status}
        {status !== 'idle' ? ` · ${elapsed}` : ''}
        {exitCode != null ? ` · exit ${exitCode}` : ''}
        {props.mode === 'selection' ? ` · ${props.paths?.length ?? 0} selected` : ''}
        {props.mode === 'global' ? ' · global' : ''}
      </div>
      <pre ref={outputRef} className="script-output" onScroll={onOutputScroll}>
        {output || 'Output appears here.'}
      </pre>
      {error && <div className="script-banner script-banner-warn">{error}</div>}
      {status === 'done' && exitCode != null && exitCode !== 0 && settings.ai.enabled && (
        <div className="script-fix">
          {!confirmFix ? (
            <button
              type="button"
              className="btn"
              title="Offer to send source, exit code, and stderr to AI. Files and listings are never sent. You confirm on the next step."
              onClick={() => setConfirmFix(true)}
            >
              Ask AI to fix…
            </button>
          ) : (
            <div className="script-banner">
              Send this source, exit code {exitCode}, and stderr
              {redactPaths ? ' (paths redacted)' : ''} to the configured AI provider? Files are never
              sent.
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={redactPaths}
                  onChange={(e) => setRedactPaths(e.target.checked)}
                />
                <span>Redact paths</span>
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={busy || aiBusy}
                onClick={() => {
                  setAiBusy(true)
                  void call(
                    api.ai.fix({
                      source,
                      exitCode: exitCode ?? 1,
                      stderr: stderrRef.current || output,
                      redactPaths,
                      target: props.mode
                    })
                  )
                    .then((res) => {
                      openDialog({
                        kind: 'script-generate',
                        scriptId: props.scriptId,
                        source: res.script.source,
                        language: res.script.language,
                        name: res.script.name,
                        description: res.script.description,
                        mode: props.mode,
                        folderPath: props.root,
                        reviewFix: true
                      })
                    })
                    .catch((e) => notify(formatError(e), true))
                    .finally(() => setAiBusy(false))
                }}
              >
                Send to AI
              </button>
              <button type="button" className="btn" onClick={() => setConfirmFix(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </ScriptModal>
  )
}
