import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import type { ScriptDefinition, ScriptLanguage, ScriptParameter } from '@shared/schemas/scripts'
import { looksDestructive, scanDestructiveSource } from '@shared/scriptDestructive'
import { CloseIcon } from '../lib/icons'
import { highlightScriptSource } from '../lib/highlight'

export function ScriptModal({
  title,
  children,
  actions,
  className,
  onClose,
  busy,
  busyTitle,
  busyHint
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  className?: string
  onClose(): void
  busy?: boolean
  busyTitle?: string
  busyHint?: string
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, busy])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className={`modal modal-wide ${className ?? ''}`.trim()}
        role="dialog"
        aria-label={title}
        aria-busy={busy || undefined}
      >
        <div className="modal-title modal-title-chrome">
          <span className="modal-title-text">{title}</span>
          <button
            type="button"
            className="modal-title-btn"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="modal-body modal-body-scripts">{children}</div>
        <div className="modal-actions">{actions}</div>
        {busy && <AiBusyOverlay title={busyTitle ?? 'Working…'} hint={busyHint} />}
      </div>
    </div>
  )
}

export function AiBusyOverlay({
  title,
  hint = 'This may take some time.'
}: {
  title: string
  hint?: string
}): JSX.Element {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="script-ai-busy" role="status" aria-live="polite">
      <div className="script-ai-busy-inner">
        <p className="script-ai-busy-title">{title}</p>
        <p className="script-ai-busy-hint">{hint}</p>
        <div className="script-ai-busy-track">
          <div className="script-ai-busy-fill" />
        </div>
        {elapsed > 0 && <p className="script-ai-busy-elapsed">{elapsed}s elapsed</p>}
      </div>
    </div>
  )
}

export function SourceEditor({
  value,
  onChange,
  language
}: {
  value: string
  onChange(next: string): void
  language: ScriptLanguage
}): JSX.Element {
  const lines = Math.max(1, value.split('\n').length)
  const html = useMemo(() => highlightScriptSource(value, language).html, [value, language])
  const gutterRef = useRef<HTMLPreElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const syncScroll = useCallback((): void => {
    const input = inputRef.current
    if (!input) return
    if (highlightRef.current) {
      highlightRef.current.scrollTop = input.scrollTop
      highlightRef.current.scrollLeft = input.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = input.scrollTop
  }, [])

  return (
    <div className="script-editor">
      <pre className="script-editor-gutter" aria-hidden ref={gutterRef}>
        {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
      </pre>
      <div className="script-editor-pane">
        <pre className="script-editor-highlight" aria-hidden ref={highlightRef}>
          <code dangerouslySetInnerHTML={{ __html: html }} />
          {value.endsWith('\n') ? '\n' : null}
        </pre>
        <textarea
          ref={inputRef}
          className="script-editor-input"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          aria-label={`${language} source`}
        />
      </div>
    </div>
  )
}

export function ParamsForm({
  parameters,
  values,
  onChange
}: {
  parameters: ScriptParameter[]
  values: Record<string, string | number | boolean>
  onChange(next: Record<string, string | number | boolean>): void
}): JSX.Element | null {
  if (parameters.length === 0) return null
  return (
    <div className="script-params">
      {parameters.map((p) => {
        const v = values[p.name] ?? p.defaultValue ?? (p.type === 'bool' ? false : '')
        return (
          <label key={p.name} className="settings-field">
            <span>
              {p.label || p.name}
              {p.required ? ' *' : ''}
            </span>
            {p.type === 'bool' ? (
              <input
                type="checkbox"
                checked={Boolean(v)}
                onChange={(e) => onChange({ ...values, [p.name]: e.target.checked })}
              />
            ) : p.type === 'choice' ? (
              <select
                value={String(v)}
                onChange={(e) => onChange({ ...values, [p.name]: e.target.value })}
              >
                {(p.choices ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={p.type === 'int' || p.type === 'float' ? 'number' : 'text'}
                step={p.type === 'float' ? 'any' : undefined}
                value={String(v)}
                onChange={(e) =>
                  onChange({
                    ...values,
                    [p.name]:
                      p.type === 'int' || p.type === 'float'
                        ? e.target.value === ''
                          ? ''
                          : Number(e.target.value)
                        : e.target.value
                  })
                }
              />
            )}
          </label>
        )
      })}
    </div>
  )
}

export function DestructiveBanner({ source, flagged }: { source: string; flagged: boolean }): JSX.Element | null {
  const hits = scanDestructiveSource(source)
  if (!flagged && hits.length === 0) return null
  return (
    <div className="script-banner script-banner-warn">
      This script looks destructive
      {hits.length > 0 ? ` (${hits.join(', ')})` : ''}. It runs as you and can delete or overwrite
      files.
    </div>
  )
}

export function RiskBanner(): JSX.Element | null {
  const acknowledged = useAppStore((s) => s.settings.scripts.acknowledgedRisk)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  if (acknowledged) return null
  return (
    <div className="script-banner">
      Scripts run as your Windows user. They can read, change, or delete files. Review source before
      Run.{' '}
      <button
        type="button"
        className="btn"
        onClick={() => void applySettingsPatch({ scripts: { acknowledgedRisk: true } })}
      >
        I understand
      </button>
    </div>
  )
}

export function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function formatError(e: unknown): string {
  return e instanceof IpcError ? e.message : e instanceof Error ? e.message : String(e)
}

export function CopyInstall({ language, deps }: { language: ScriptLanguage; deps: string[] }): JSX.Element | null {
  if (deps.length === 0) return null
  const cmd =
    language === 'python'
      ? `pip install ${deps.join(' ')}`
      : language === 'powershell'
        ? deps.map((d) => `Install-Module -Name ${d}`).join('; ')
        : deps.join(' ')
  return (
    <div className="script-banner">
      Declared dependencies: {deps.join(', ')}.{' '}
      <button
        type="button"
        className="btn"
        onClick={() => void navigator.clipboard.writeText(cmd)}
      >
        Copy install command
      </button>
    </div>
  )
}

export function useScriptLibrary(): {
  scripts: ScriptDefinition[]
  reload(): Promise<void>
} {
  const scripts = useAppStore((s) => s.scriptLibrary)
  const reload = useAppStore((s) => s.refreshScriptLibrary)
  return { scripts, reload }
}

export { looksDestructive, call, api }
