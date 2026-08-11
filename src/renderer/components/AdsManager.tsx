import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { formatAdsValuePreview } from '@shared/ads/paths'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import type { Settings } from '@shared/schemas/settings'

type StreamRow = { name: string; size: number; valuePreview: string }

type Bounds = { x: number; y: number; width: number; height: number }

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MIN_W = 420
const MIN_H = 320
const DEFAULT_W = 720
const DEFAULT_H = 560
/** Skip reading huge streams for the Value preview column. */
const VALUE_PREVIEW_MAX_BYTES = 64 * 1024

function formatSizeParts(n: number): { value: string; unit: string } {
  if (!Number.isFinite(n) || n < 0) return { value: '', unit: '' }
  if (n < 1024) return { value: String(n), unit: 'B' }
  if (n < 1024 * 1024) return { value: (n / 1024).toFixed(1), unit: 'KB' }
  return { value: (n / (1024 * 1024)).toFixed(2), unit: 'MB' }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function base64ToBytes(dataBase64: string): Uint8Array {
  const bin = atob(dataBase64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function clampBounds(b: Bounds): Bounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.max(MIN_W, Math.floor(vw * 0.96))
  const maxH = Math.max(MIN_H, Math.floor(vh * 0.92))
  const width = Math.min(Math.max(Math.round(b.width), MIN_W), maxW)
  const height = Math.min(Math.max(Math.round(b.height), MIN_H), maxH)
  const x = Math.min(Math.max(Math.round(b.x), 0), Math.max(0, vw - width))
  const y = Math.min(Math.max(Math.round(b.y), 0), Math.max(0, vh - height))
  return { x, y, width, height }
}

function defaultBounds(): Bounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(DEFAULT_W, Math.floor(vw * 0.96))
  const height = Math.min(DEFAULT_H, Math.floor(vh * 0.92))
  return clampBounds({
    x: (vw - width) / 2,
    y: (vh - height) / 2,
    width,
    height
  })
}

function boundsFromSettings(saved: Settings['adsManagerBounds']): Bounds {
  if (!saved) return defaultBounds()
  return clampBounds(saved)
}

/**
 * NTFS Alternate Data Streams manager — list / add / edit text / delete / import-export bytes.
 * Geometry (size + position) is user-resizable and persisted in settings.
 */
export function AdsManager({ path }: { path: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const notify = useAppStore((s) => s.notify)
  const bumpColumnMeta = useAppStore((s) => s.bumpColumnMeta)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const savedBounds = useAppStore((s) => s.settings.adsManagerBounds)

  const [bounds, setBounds] = useState<Bounds>(() => boundsFromSettings(savedBounds))
  const [streams, setStreams] = useState<StreamRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'idle' | 'add' | 'edit'>('idle')
  const [draftName, setDraftName] = useState('')
  const [draftText, setDraftText] = useState('')
  const [busy, setBusy] = useState(false)

  const boundsRef = useRef(bounds)
  useEffect(() => {
    boundsRef.current = bounds
  }, [bounds])
  const dragRef = useRef<{
    kind: 'move' | ResizeEdge
    startX: number
    startY: number
    orig: Bounds
  } | null>(null)
  const endDragRef = useRef<() => void>(() => {})

  const persistBounds = useCallback(
    (next: Bounds) => {
      const clamped = clampBounds(next)
      void applySettingsPatch({ adsManagerBounds: clamped })
    },
    [applySettingsPatch]
  )

  useEffect(() => {
    const onResize = (): void => {
      setBounds((b) => clampBounds(b))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const res = await call(api.ads.list({ path }))
      const rows: StreamRow[] = await Promise.all(
        res.streams.map(async (s) => {
          if (s.size <= 0) return { ...s, valuePreview: '' }
          if (s.size > VALUE_PREVIEW_MAX_BYTES) return { ...s, valuePreview: '[...]' }
          try {
            const { text } = await call(api.ads.readText({ path, name: s.name }))
            return { ...s, valuePreview: formatAdsValuePreview(text) }
          } catch {
            return { ...s, valuePreview: '[...]' }
          }
        })
      )
      setStreams(rows)
      setSelected((cur) => (cur && rows.some((s) => s.name === cur) ? cur : null))
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true)
      setStreams([])
    } finally {
      setLoading(false)
    }
  }, [path, notify])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && mode === 'idle') {
        e.preventDefault()
        e.stopPropagation()
        closeDialog()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode, closeDialog])

  const afterMutation = async (): Promise<void> => {
    await api.meta.invalidate({ paths: [path] })
    bumpColumnMeta(path)
    await refresh()
  }

  const startAdd = (): void => {
    setMode('add')
    setSelected(null)
    setDraftName('')
    setDraftText('')
  }

  const startEdit = async (name: string): Promise<void> => {
    setBusy(true)
    try {
      const res = await call(api.ads.readText({ path, name }))
      setSelected(name)
      setDraftName(name)
      setDraftText(res.text)
      setMode('edit')
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const cancelForm = (): void => {
    setMode('idle')
    setDraftName('')
    setDraftText('')
  }

  const commitForm = async (): Promise<void> => {
    const name = draftName.trim()
    if (!name) {
      notify('Stream name is required', true)
      return
    }
    if (mode === 'add' && streams.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      notify(`Stream "${name}" already exists`, true)
      return
    }
    setBusy(true)
    try {
      await call(api.ads.writeText({ path, name, value: draftText }))
      setMode('idle')
      await afterMutation()
      setSelected(name)
      notify(mode === 'add' ? `Created stream ${name}` : `Saved stream ${name}`)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const deleteSelected = async (): Promise<void> => {
    if (!selected) return
    if (!window.confirm(`Delete alternate stream "${selected}"?`)) return
    const name = selected
    setBusy(true)
    try {
      await call(api.ads.delete({ path, name }))
      setSelected(null)
      await afterMutation()
      notify(`Deleted stream ${name}`)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const exportSelected = async (): Promise<void> => {
    if (!selected) return
    setBusy(true)
    try {
      const res = await call(api.ads.readBytes({ path, name: selected }))
      if (res.dataBase64 == null) {
        notify('Stream is empty or missing', true)
        return
      }
      const bytes = base64ToBytes(res.dataBase64)
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      const blob = new Blob([copy])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = selected.replace(/[<>:"/\\|?*]/g, '_')
      a.click()
      URL.revokeObjectURL(url)
      notify(`Exported ${selected}`)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const importBytes = (): void => {
    const nameHint = mode === 'add' || mode === 'edit' ? draftName.trim() : (selected ?? '')
    const streamName = nameHint || window.prompt('Stream name for import')
    if (!streamName?.trim()) return
    const target = streamName.trim()
    const input = document.createElement('input')
    input.type = 'file'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      void (async () => {
        setBusy(true)
        try {
          const buf = new Uint8Array(await file.arrayBuffer())
          await call(api.ads.writeBytes({ path, name: target, dataBase64: bytesToBase64(buf) }))
          setMode('idle')
          await afterMutation()
          setSelected(target)
          notify(`Imported into stream ${target}`)
        } catch (e) {
          notify(e instanceof Error ? e.message : String(e), true)
        } finally {
          setBusy(false)
        }
      })()
    }
    input.click()
  }

  const onPointerMove = useCallback((e: PointerEvent): void => {
    const drag = dragRef.current
    if (!drag) return
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
      // Keep opposite edge fixed when hitting min size.
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
      persistBounds(boundsRef.current)
    }
  }, [onPointerMove, onPointerUp, persistBounds])

  const beginDrag = (kind: 'move' | ResizeEdge, e: ReactPointerEvent): void => {
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
  }

  const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  return (
    <div className="modal-backdrop" onMouseDown={() => closeDialog()}>
      <div
        className="modal modal-ads-manager"
        role="dialog"
        aria-label="Alternate data streams"
        style={{
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {edges.map((edge) => (
          <div
            key={edge}
            className={`ads-resize-handle ${edge}`}
            onPointerDown={(e) => beginDrag(edge, e)}
          />
        ))}
        <div className="modal-title" onPointerDown={(e) => beginDrag('move', e)}>
          Alternate data streams
        </div>
        <p className="ads-path muted" title={path}>
          {path}
        </p>
        <div className="modal-body modal-body-ads">
          <div className="ads-toolbar">
            <div className="ads-toolbar-actions">
              <button type="button" className="btn" disabled={busy} onClick={startAdd}>
                Add text…
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !selected}
                onClick={() => selected && void startEdit(selected)}
              >
                Edit text…
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !selected}
                onClick={() => void deleteSelected()}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !selected}
                onClick={() => void exportSelected()}
              >
                Export…
              </button>
              <button type="button" className="btn" disabled={busy} onClick={importBytes}>
                Import…
              </button>
              <button type="button" className="btn" disabled={busy || loading} onClick={() => void refresh()}>
                Refresh
              </button>
            </div>
          </div>

          {mode !== 'idle' ? (
            <div className="ads-form">
              <label className="ads-field">
                <span>Name</span>
                <input
                  value={draftName}
                  disabled={mode === 'edit' || busy}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="StreamName"
                />
              </label>
              <label className="ads-field ads-field-grow">
                <span>Text</span>
                <textarea
                  value={draftText}
                  disabled={busy}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={8}
                  spellCheck={false}
                />
              </label>
            </div>
          ) : (
            <div className="ads-table-wrap">
              {loading ? (
                <p className="muted">Loading…</p>
              ) : streams.length === 0 ? (
                <p className="muted">No alternate streams on this item.</p>
              ) : (
                <table className="ads-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th className="ads-col-size">Size</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {streams.map((s) => {
                      const size = formatSizeParts(s.size)
                      return (
                        <tr
                          key={s.name}
                          className={selected === s.name ? 'selected' : undefined}
                          onClick={() => setSelected(s.name)}
                          onDoubleClick={() => void startEdit(s.name)}
                        >
                          <td>{s.name}</td>
                          <td className="ads-col-size">
                            <span className="ads-size">
                              <span className="ads-size-n">{size.value}</span>
                              <span className="ads-size-u">{size.unit}</span>
                            </span>
                          </td>
                          <td className="ads-value" title={s.valuePreview}>
                            {s.valuePreview}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
        <div className="modal-actions">
          {mode !== 'idle' ? (
            <>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void commitForm()}>
                Save
              </button>
              <button type="button" className="btn" disabled={busy} onClick={cancelForm}>
                Cancel
              </button>
            </>
          ) : null}
          <button type="button" className="btn" onClick={() => closeDialog()}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
