import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { ScriptDefinition, ScriptLanguage, ScriptRunMode } from '@shared/schemas/scripts'
import { useAppStore } from '../store/appStore'
import {
  CopyInstall,
  DestructiveBanner,
  ParamsForm,
  RiskBanner,
  ScriptModal,
  formatError,
  newRunId,
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
}): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const notify = useAppStore((s) => s.notify)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const settings = useAppStore((s) => s.settings)
  const persistRunnerBounds = useCallback(
    (next: { x: number; y: number; width: number; height: number }) => {
      void applySettingsPatch({ scriptRunnerBounds: next })
    },
    [applySettingsPatch]
  )

  const [script, setScript] = useState<ScriptDefinition | null>(null)
  const [source, setSource] = useState(props.source ?? '')
  const [language, setLanguage] = useState<ScriptLanguage>(props.language ?? 'powershell')
  const [params, setParams] = useState<Record<string, string | number | boolean>>({})
  const [recursive, setRecursive] = useState(props.recursive ?? false)
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState('0.0s')
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmFix, setConfirmFix] = useState(false)
  const [redactPaths, setRedactPaths] = useState(true)
  const runIdRef = useRef<string | null>(null)
  const stderrRef = useRef('')

  useEffect(() => {
    if (!props.scriptId) return
    void (async () => {
      try {
        const res = await call(api.script.get({ id: props.scriptId! }))
        setScript(res.script)
        setSource(res.source)
        setLanguage(res.script.language)
        setRecursive(props.recursive ?? res.script.recursive)
        const initial: Record<string, string | number | boolean> = {}
        for (const p of res.script.parameters) {
          if (p.defaultValue !== undefined) initial[p.name] = p.defaultValue
        }
        setParams(initial)
      } catch (e) {
        setError(formatError(e))
      }
    })()
  }, [props.scriptId, props.recursive])

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
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    if (status !== 'running' || !startedAt) return
    const t = setInterval(() => {
      setElapsed(`${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
    }, 250)
    return () => clearInterval(t)
  }, [status, startedAt])

  const start = useCallback(
    async (dryRun: boolean) => {
      if (!settings.scripts.acknowledgedRisk) {
        setError('Acknowledge the first-run warning before running a script.')
        return
      }
      setError(null)
      setOutput('')
      stderrRef.current = ''
      setExitCode(null)
      const runId = newRunId()
      runIdRef.current = runId
      setStatus('running')
      setStartedAt(Date.now())
      setBusy(true)
      try {
        const res = await call(
          api.script.run({
            runId,
            scriptId: props.scriptId,
            source: props.scriptId ? undefined : source,
            language: props.scriptId ? undefined : language,
            mode: props.mode,
            root: props.root,
            paths: props.paths,
            recursive,
            dryRun,
            params
          })
        )
        setExitCode(res.exitCode)
        setStatus('done')
        setElapsed(`${(res.elapsedMs / 1000).toFixed(1)}s`)
        if (res.output && !output) setOutput(res.output)
      } catch (e) {
        setError(formatError(e))
        setStatus('done')
      } finally {
        setBusy(false)
      }
    },
    [
      language,
      output,
      params,
      props.mode,
      props.paths,
      props.root,
      props.scriptId,
      recursive,
      settings.scripts.acknowledgedRisk,
      source
    ]
  )

  const stop = (): void => {
    if (runIdRef.current) void call(api.script.cancel({ runId: runIdRef.current })).catch(() => {})
  }

  const title = props.name || script?.name || 'Run script'
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
      onClose={() => {
        if (aiBusy) return
        if (status === 'running') stop()
        closeDialog()
      }}
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
          ) : (
            <>
              {dryOk && (
                <button
                  type="button"
                  className="btn"
                  title="Run with --dry-run so the script can preview without writing."
                  disabled={busy}
                  onClick={() => void start(true)}
                >
                  Dry run
                </button>
              )}
              <button
                type="button"
                className="btn primary"
                title="Execute as your Windows user. Output streams here; use Stop to cancel."
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
            title="Close this run window. A running script is stopped first."
            disabled={aiBusy}
            onClick={closeDialog}
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
      <pre className="script-output">{output || 'Output appears here.'}</pre>
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
