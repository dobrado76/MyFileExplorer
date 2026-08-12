import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { api, call } from '../lib/ipc'
import { useAppStore } from '../store/appStore'
import type { RemoteConnection, RemoteProtocol } from '@shared/schemas/remoteConnections'
import { DEFAULT_REMOTE_PORTS, REMOTE_TEST_PRESETS } from '@shared/schemas/remoteConnections'
import type { Settings } from '@shared/schemas/settings'
import { PlusIcon, TrashIcon, EditImageIcon, RefreshIcon, CloseIcon, SpinnerIcon } from '../lib/icons'

type ConnectFeedback =
  | { status: 'connecting'; name: string }
  | { status: 'error'; name: string; message: string }

export function RemoteReposToolbar(): JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const notify = useAppStore((s) => s.notify)
  const newTab = useAppStore((s) => s.newTab)
  const remoteBusyDialog = useAppStore((s) => s.remoteBusyDialog)
  const clearRemoteBusyDialog = useAppStore((s) => s.clearRemoteBusyDialog)
  const [connections, setConnections] = useState<RemoteConnection[]>([])
  const [connectedIds, setConnectedIds] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<RemoteConnection | null>(null)
  const [connectFeedback, setConnectFeedback] = useState<ConnectFeedback | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await call(api.remote.listConnections())
      setConnections(list.connections)
      setSelectedId((prev) => {
        if (prev && list.connections.some((c) => c.id === prev)) return prev
        return list.connections[0]?.id ?? ''
      })
      const live = await call(api.remote.connectedIds())
      setConnectedIds(live.ids)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to load remote connections', true)
    }
  }, [notify])

  useEffect(() => {
    if (!settings.remoteRepos.enabled) return
    void refresh()
  }, [settings.remoteRepos.enabled, refresh])

  const busyHost =
    remoteBusyDialog != null ? (
      <RemoteStatusModal
        title={remoteBusyDialog.title}
        spinning={remoteBusyDialog.status === 'working'}
        body={
          remoteBusyDialog.status === 'working' ? (
            <div className="remote-connect-status-row">
              <SpinnerIcon size={22} className="spin" />
              <span>{remoteBusyDialog.message}</span>
            </div>
          ) : (
            <div className="remote-connect-status-error">
              <p className="remote-connect-status-target">{remoteBusyDialog.message}</p>
              <p className="remote-connect-status-message">{remoteBusyDialog.detail}</p>
            </div>
          )
        }
        onDismiss={clearRemoteBusyDialog}
      />
    ) : null

  if (!settings.remoteRepos.enabled) {
    return busyHost
  }

  const selected = connections.find((c) => c.id === selectedId) ?? null
  const isConnected = selected ? connectedIds.includes(selected.id) : false

  const onConnect = async (): Promise<void> => {
    if (!selected || connectFeedback?.status === 'connecting') return
    const name = selected.name
    setConnectFeedback({ status: 'connecting', name })
    try {
      const res = await call(api.remote.connect({ id: selected.id }))
      await newTab(res.location)
      await refresh()
      setConnectFeedback(null)
      notify(`Connected to ${name}`)
    } catch (e) {
      setConnectFeedback({
        status: 'error',
        name,
        message: e instanceof Error ? e.message : 'Connect failed'
      })
    }
  }

  const onDisconnect = async (): Promise<void> => {
    if (!selected) return
    try {
      await call(api.remote.disconnect({ id: selected.id }))
      await refresh()
      notify(`Disconnected ${selected.name}`)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Disconnect failed', true)
    }
  }

  const onDelete = async (): Promise<void> => {
    if (!selected) return
    if (!window.confirm(`Delete remote connection “${selected.name}”?`)) return
    try {
      await call(api.remote.deleteConnection({ id: selected.id }))
      setSelectedId('')
      await refresh()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Delete failed', true)
    }
  }

  const onRename = async (): Promise<void> => {
    if (!selected) return
    const name = window.prompt('Rename connection', selected.name)?.trim()
    if (!name || name === selected.name) return
    try {
      await call(api.remote.renameConnection({ id: selected.id, name }))
      await refresh()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Rename failed', true)
    }
  }

  return (
    <>
      <div className="toolbar-edit" role="group" aria-label="Remote repositories">
        <span className="toolbar-sep" aria-hidden />
        <select
          className="toolbar-remote-select"
          aria-label="Remote connection"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          title="Select remote connection"
        >
          {connections.length === 0 ? (
            <option value="">No connections</option>
          ) : (
            connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.protocol})
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          className="icon-btn"
          title="Add remote connection"
          aria-label="Add remote connection"
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Edit remote connection"
          aria-label="Edit remote connection"
          disabled={!selected}
          onClick={() => {
            if (!selected) return
            setEditing(selected)
            setEditorOpen(true)
          }}
        >
          <EditImageIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Rename remote connection"
          aria-label="Rename remote connection"
          disabled={!selected}
          onClick={() => void onRename()}
        >
          <span className="toolbar-remote-glyph" aria-hidden>
            Aa
          </span>
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Delete remote connection"
          aria-label="Delete remote connection"
          disabled={!selected}
          onClick={() => void onDelete()}
        >
          <TrashIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Connect"
          aria-label="Connect"
          disabled={!selected || isConnected || connectFeedback?.status === 'connecting'}
          onClick={() => void onConnect()}
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Disconnect"
          aria-label="Disconnect"
          disabled={!selected || !isConnected}
          onClick={() => void onDisconnect()}
        >
          <CloseIcon />
        </button>
      </div>
      {editorOpen && (
        <RemoteConnectionEditor
          initial={editing}
          onClose={() => setEditorOpen(false)}
          onSaved={async (id) => {
            setEditorOpen(false)
            setSelectedId(id)
            await refresh()
          }}
        />
      )}
      {connectFeedback && (
        <RemoteStatusModal
          title={connectFeedback.status === 'connecting' ? 'Connecting' : 'Connection failed'}
          spinning={connectFeedback.status === 'connecting'}
          body={
            connectFeedback.status === 'connecting' ? (
              <div className="remote-connect-status-row">
                <SpinnerIcon size={22} className="spin" />
                <span>Connecting to {connectFeedback.name}…</span>
              </div>
            ) : (
              <div className="remote-connect-status-error">
                <p className="remote-connect-status-target">
                  Could not connect to {connectFeedback.name}.
                </p>
                <p className="remote-connect-status-message">{connectFeedback.message}</p>
              </div>
            )
          }
          onDismiss={() => setConnectFeedback(null)}
        />
      )}
      {busyHost}
    </>
  )
}

function RemoteStatusModal({
  title,
  spinning,
  body,
  onDismiss
}: {
  title: string
  spinning: boolean
  body: ReactNode
  onDismiss: () => void
}): JSX.Element {
  useEffect(() => {
    if (spinning) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [spinning, onDismiss])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (spinning) return
        if (e.target === e.currentTarget) onDismiss()
      }}
    >
      <div
        className="modal modal-remote-connect-status"
        role="dialog"
        aria-label={title}
        aria-busy={spinning || undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{title}</div>
        <div className="modal-body modal-body-remote-connect-status">{body}</div>
        {!spinning && (
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={onDismiss} autoFocus>
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

type Bounds = { x: number; y: number; width: number; height: number }
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type StoredBounds = NonNullable<Settings['remoteConnectionBounds']>

const MIN_W = 520
const MIN_H = 420
const DEFAULT_W = 640
const DEFAULT_H = 560

function clampBounds(b: Bounds): Bounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.max(MIN_W, Math.floor(vw * 0.98))
  const maxH = Math.max(MIN_H, Math.floor(vh * 0.94))
  const width = Math.min(Math.max(Math.round(b.width), MIN_W), maxW)
  const height = Math.min(Math.max(Math.round(b.height), MIN_H), maxH)
  const x = Math.min(Math.max(Math.round(b.x), 0), Math.max(0, vw - width))
  const y = Math.min(Math.max(Math.round(b.y), 0), Math.max(0, vh - height))
  return { x, y, width, height }
}

function maximizedBounds(): Bounds {
  const pad = 6
  const vw = window.innerWidth
  const vh = window.innerHeight
  return {
    x: pad,
    y: pad,
    width: Math.max(MIN_W, vw - pad * 2),
    height: Math.max(MIN_H, vh - pad * 2)
  }
}

function defaultBounds(): Bounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(DEFAULT_W, Math.floor(vw * 0.92))
  const height = Math.min(DEFAULT_H, Math.floor(vh * 0.88))
  return clampBounds({
    x: (vw - width) / 2,
    y: (vh - height) / 2,
    width,
    height
  })
}

function normalBoundsFromSettings(saved: Settings['remoteConnectionBounds']): Bounds {
  if (!saved) return defaultBounds()
  return clampBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height })
}

function RemoteConnectionModalShell({
  title,
  children,
  actions,
  onClose
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  onClose(): void
}): JSX.Element {
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const savedBounds = useAppStore((s) => s.settings.remoteConnectionBounds)

  const [maximized, setMaximized] = useState(() => !!savedBounds?.maximized)
  const restoreBoundsRef = useRef<Bounds>(normalBoundsFromSettings(savedBounds))
  const [bounds, setBounds] = useState<Bounds>(() =>
    savedBounds?.maximized ? maximizedBounds() : normalBoundsFromSettings(savedBounds)
  )

  const boundsRef = useRef(bounds)
  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])
  const maximizedRef = useRef(maximized)
  useEffect(() => {
    maximizedRef.current = maximized
  }, [maximized])

  const dragRef = useRef<{
    kind: 'move' | ResizeEdge
    startX: number
    startY: number
    orig: Bounds
  } | null>(null)
  const endDragRef = useRef<() => void>(() => {})

  const persistState = useCallback(
    (normal: Bounds, isMax: boolean) => {
      const clamped = clampBounds(normal)
      const payload: StoredBounds = { ...clamped, maximized: isMax }
      void applySettingsPatch({ remoteConnectionBounds: payload })
    },
    [applySettingsPatch]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    const onResize = (): void => {
      if (maximizedRef.current) setBounds(maximizedBounds())
      else setBounds((b) => clampBounds(b))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const toggleMaximize = useCallback((): void => {
    if (maximizedRef.current) {
      const restored = clampBounds(restoreBoundsRef.current)
      setBounds(restored)
      setMaximized(false)
      persistState(restored, false)
      return
    }
    restoreBoundsRef.current = boundsRef.current
    setBounds(maximizedBounds())
    setMaximized(true)
    persistState(restoreBoundsRef.current, true)
  }, [persistState])

  const onPointerMove = useCallback((e: PointerEvent): void => {
    const drag = dragRef.current
    if (!drag || maximizedRef.current) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const o = drag.orig
    let next = { ...o }
    if (drag.kind === 'move') {
      next = { ...o, x: o.x + dx, y: o.y + dy }
    } else {
      const edge = drag.kind
      if (edge.includes('e')) next.width = o.width + dx
      if (edge.includes('s')) next.height = o.height + dy
      if (edge.includes('w')) {
        next.width = o.width - dx
        next.x = o.x + dx
      }
      if (edge.includes('n')) {
        next.height = o.height - dy
        next.y = o.y + dy
      }
      if (edge.includes('w') && next.width < MIN_W) {
        next.x = o.x + o.width - MIN_W
        next.width = MIN_W
      }
      if (edge.includes('n') && next.height < MIN_H) {
        next.y = o.y + o.height - MIN_H
        next.height = MIN_H
      }
    }
    setBounds(clampBounds(next))
  }, [])

  const onPointerUp = useCallback((): void => {
    endDragRef.current()
  }, [])

  useEffect(() => {
    endDragRef.current = (): void => {
      if (!dragRef.current) return
      dragRef.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      if (!maximizedRef.current) {
        restoreBoundsRef.current = boundsRef.current
        persistState(boundsRef.current, false)
      }
    }
  }, [onPointerMove, onPointerUp, persistState])

  const onChromePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (maximizedRef.current) return
      const kindAttr = e.currentTarget.dataset.dragKind
      const kind: 'move' | ResizeEdge =
        kindAttr === 'move' || !kindAttr ? 'move' : (kindAttr as ResizeEdge)
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        orig: boundsRef.current
      }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    },
    [onPointerMove, onPointerUp]
  )

  const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal modal-remote-connection${maximized ? ' is-maximized' : ''}`}
        role="dialog"
        aria-label={title}
        style={{
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!maximized &&
          edges.map((edge) => (
            <div
              key={edge}
              className={`modal-resize-handle ${edge}`}
              data-drag-kind={edge}
              onPointerDown={onChromePointerDown}
            />
          ))}
        <div
          className="modal-title modal-title-chrome"
          data-drag-kind="move"
          onPointerDown={onChromePointerDown}
          onDoubleClick={(e) => {
            e.preventDefault()
            toggleMaximize()
          }}
        >
          <span className="modal-title-text">{title}</span>
          <button
            type="button"
            className="modal-title-btn"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            title={maximized ? 'Restore' : 'Maximize'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleMaximize()
            }}
          >
            {maximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="3" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <rect
                  x="1"
                  y="3"
                  width="7"
                  height="7"
                  fill="var(--bg, #1a1d24)"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
        </div>
        <div className="modal-body modal-body-remote-connection">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

function RemoteConnectionEditor({
  initial,
  onClose,
  onSaved
}: {
  initial: RemoteConnection | null
  onClose: () => void
  onSaved: (id: string) => void | Promise<void>
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [name, setName] = useState(initial?.name ?? '')
  const [protocol, setProtocol] = useState<RemoteProtocol>(initial?.protocol ?? 'sftp')
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(String(initial?.port ?? DEFAULT_REMOTE_PORTS.sftp))
  const [username, setUsername] = useState(initial?.username ?? '')
  const [password, setPassword] = useState('')
  const [startPath, setStartPath] = useState(initial?.startPath ?? '/')
  const [insecureAck, setInsecureAck] = useState(initial?.insecureFtpAck ?? false)
  const [clearFingerprint, setClearFingerprint] = useState(false)
  const [busy, setBusy] = useState(false)

  const applyPreset = (id: string): void => {
    const p = REMOTE_TEST_PRESETS.find((x) => x.id === id)
    if (!p) return
    setName(p.label)
    setProtocol(p.protocol)
    setHost(p.host)
    setPort(String(p.port))
    setUsername(p.username)
    setPassword(p.password)
    setStartPath(p.startPath)
    setInsecureAck(p.insecureFtpAck)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await call(
        api.remote.upsertConnection({
          id: initial?.id,
          name: name.trim() || host.trim() || 'Remote',
          protocol,
          host: host.trim(),
          port: Number(port) || DEFAULT_REMOTE_PORTS[protocol],
          username: username.trim() || 'anonymous',
          startPath: startPath.trim() || '/',
          insecureFtpAck: protocol === 'ftp' ? insecureAck : false,
          password: password !== '' ? password : initial ? undefined : null,
          clearFingerprint: clearFingerprint || undefined
        })
      )
      await onSaved(res.connection.id)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Save failed', true)
    } finally {
      setBusy(false)
    }
  }

  const title = initial ? 'Edit remote connection' : 'Add remote connection'

  return (
    <RemoteConnectionModalShell
      title={title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <div className="remote-conn-form">
        <label className="remote-conn-row">
          <span>Test preset</span>
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) applyPreset(e.target.value)
            }}
          >
            <option value="">— optional —</option>
            {REMOTE_TEST_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="remote-conn-row">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="remote-conn-row">
          <span>Protocol</span>
          <select
            value={protocol}
            onChange={(e) => {
              const next = e.target.value as RemoteProtocol
              setProtocol(next)
              setPort(String(DEFAULT_REMOTE_PORTS[next]))
              if (next !== 'ftp') setInsecureAck(false)
            }}
          >
            <option value="sftp">SFTP</option>
            <option value="ftps">FTPS</option>
            <option value="ftp">FTP (cleartext)</option>
          </select>
        </label>
        <label className="remote-conn-row">
          <span>Host</span>
          <input value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="remote-conn-row">
          <span>Port</span>
          <input value={port} onChange={(e) => setPort(e.target.value)} />
        </label>
        <label className="remote-conn-row">
          <span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="remote-conn-row">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder={initial?.hasPassword ? 'Leave blank to keep' : undefined}
          />
        </label>
        <label className="remote-conn-row">
          <span>Start path</span>
          <input value={startPath} onChange={(e) => setStartPath(e.target.value)} />
        </label>
        {protocol === 'ftp' && (
          <label className="remote-conn-check">
            <input
              type="checkbox"
              checked={insecureAck}
              onChange={(e) => setInsecureAck(e.target.checked)}
            />
            <span>I understand FTP sends credentials and files unencrypted</span>
          </label>
        )}
        {initial?.hostFingerprint ? (
          <label className="remote-conn-check">
            <input
              type="checkbox"
              checked={clearFingerprint}
              onChange={(e) => setClearFingerprint(e.target.checked)}
            />
            <span>Clear stored host fingerprint (re-trust on next connect)</span>
          </label>
        ) : null}
      </div>
    </RemoteConnectionModalShell>
  )
}
