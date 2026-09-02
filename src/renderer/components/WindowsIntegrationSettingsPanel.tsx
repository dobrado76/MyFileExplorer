import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ShellRedirectGetStatusResponse, ShellRedirectInvocation } from '@shared/schemas/shellRedirect'
import { api, call, IpcError } from '../lib/ipc'
import { useAppStore } from '../store/appStore'

function statusLabel(status: ShellRedirectGetStatusResponse['status'], launcherExists: boolean): string {
  if (!launcherExists && status === 'disabled') return 'Launcher missing'
  switch (status) {
    case 'enabled':
      return 'Enabled'
    case 'drifted':
      return 'Drifted — repair required'
    case 'missingLauncher':
      return 'Launcher missing'
    case 'restoreRequired':
      return 'Restore required'
    default:
      return 'Disabled'
  }
}

function SettingsToggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="settings-toggle" htmlFor={id} title={hint}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {hint ? <span className="settings-field-hint">{hint}</span> : null}
      </span>
    </label>
  )
}

export function WindowsIntegrationSettingsPanel(): JSX.Element | null {
  const notify = useAppStore((s) => s.notify)
  const [status, setStatus] = useState<ShellRedirectGetStatusResponse | null>(null)
  const [invocations, setInvocations] = useState<ShellRedirectInvocation[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await call(api.shell.redirectGetStatus())
      setStatus(res)
      const inv = await call(api.shell.redirectReadInvocations({ limit: 20 }))
      setInvocations(inv.invocations)
    } catch {
      setStatus(null)
      setInvocations([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await refresh()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : e instanceof Error ? e.message : 'Operation failed', true)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const onToggle = (want: boolean) => {
    if (want) {
      if (status && status.launcherExists === false) {
        notify(
          'MfeShellLauncher.exe not found. Run: dotnet publish tools/MfeShellLauncher/src/MfeShellLauncher -c Release -r win-x64 -o tools/MfeShellLauncher/publish',
          true
        )
        return
      }
      void run(() => call(api.shell.redirectEnable()))
      return
    }
    if (
      !window.confirm(
        'Restore your previous folder-opening configuration? This removes MyFileExplorer from Directory open/explore verbs.'
      )
    ) {
      void refresh()
      return
    }
    void run(() => call(api.shell.redirectRestore()))
  }

  const active = status?.active === true
  const launcherMissing = status != null && status.launcherExists === false

  return (
    <div className="settings-stack">
      <p className="settings-help settings-callout-warn">
        <strong>Experimental.</strong> Attempts to redirect physical-directory opens that resolve
        through HKCU <code>Directory\shell\open</code> and <code>explore</code>. Apps that launch{' '}
        <code>explorer.exe</code> directly, Win+E, the taskbar, and the desktop shell are
        unaffected. Actual coverage is measured locally — see invocation log below.
      </p>

      <div className="settings-inline">
        <span
          className={`context-menu-discover-badge${
            status?.status === 'enabled' && !launcherMissing ? '' : ' warn'
          }`}
        >
          {status ? statusLabel(status.status, status.launcherExists) : '…'}
        </span>
      </div>

      {launcherMissing ? (
        <p className="settings-help settings-callout-warn">
          Launcher not found at <code>{status.launcherPath}</code>. For{' '}
          <code>npm run dev</code>, publish it first:
          <br />
          <code>
            dotnet publish tools/MfeShellLauncher/src/MfeShellLauncher -c Release -r win-x64 -o
            tools/MfeShellLauncher/publish
          </code>
          <br />
          Installed builds ship <code>MfeShellLauncher.exe</code> next to MyFileExplorer.exe.
        </p>
      ) : null}

      <SettingsToggle
        id="set-shell-redirect"
        label="Redirect folder openings to MyFileExplorer"
        hint={
          launcherMissing
            ? 'Build MfeShellLauncher.exe first (see message above).'
            : 'Per-user registry integration. Machine-local — not included in settings export/import.'
        }
        checked={active}
        disabled={busy || (launcherMissing && !active)}
        onChange={onToggle}
      />

      {status?.userRequested && !active ? (
        <p className="settings-help settings-callout-warn">
          Redirect was requested but registry state does not match. Use <strong>Repair</strong> or{' '}
          <strong>Restore previous folder-opening configuration</strong>.
        </p>
      ) : null}

      <div className="form-section">Actions</div>
      <div className="settings-inline">
        <button
          type="button"
          className="btn"
          disabled={busy || !active}
          onClick={() => void run(() => call(api.shell.redirectTest()))}
        >
          Test
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || launcherMissing}
          onClick={() => void run(() => call(api.shell.redirectRepair()))}
        >
          Repair
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !status?.userRequested}
          onClick={() => {
            if (
              !window.confirm(
                'Restore your previous folder-opening configuration from backup?'
              )
            )
              return
            void run(() => call(api.shell.redirectRestore()))
          }}
        >
          Restore previous folder-opening configuration
        </button>
      </div>

      {status ? (
        <p className="settings-help">
          Launcher: <code>{status.launcherPath}</code>
          {status.launcherExists ? '' : ' (missing)'}
          <br />
          Active keys: {status.activeKeys.length ? status.activeKeys.join(', ') : 'none'}
          <br />
          Invocations logged: {status.invocationCount}
        </p>
      ) : null}

      <div className="form-section">Invocation log</div>
      <p className="settings-help">
        Records full filesystem paths on this PC only for local diagnostics. Not included in
        settings export or automatic bug reports.
      </p>
      <div className="settings-inline">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh log
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void run(() => call(api.shell.redirectClearInvocations()))}
        >
          Clear log
        </button>
      </div>
      {invocations.length === 0 ? (
        <p className="settings-help">No invocations yet.</p>
      ) : (
        <ul className="settings-list-compact">
          {invocations.map((inv, i) => (
            <li key={`${inv.timestamp}-${i}`}>
              <code>{inv.action}</code> · {inv.verb} · {inv.target}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
