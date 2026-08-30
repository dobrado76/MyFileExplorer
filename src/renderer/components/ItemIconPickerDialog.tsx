import { createElement, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ItemIcon } from '@shared/schemas/itemAds'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { basename } from '../lib/paths'
import { filterLucideIcons, humanizeIconName, resolveLucideIcon } from '../lib/lucideIcons'
import { ShellIcon } from './ShellIcon'
import { ShellTint } from './ShellIcon'

const COLS = 10
const CELL = 40
const DEFAULT_COLOR = '#60a5fa'
const PRESET_COLORS = [
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#fb7185',
  '#38bdf8',
  '#94a3b8',
  '#e2e8f0',
  '#f8fafc'
]

function normalizeHex(raw: string): string | null {
  const s = raw.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase()
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s.toLowerCase()}`
  return null
}

type Mode = 'shell' | 'lucide' | 'custom'

export function ItemIconPickerDialog({ path }: { path: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const bumpColumnMeta = useAppStore((s) => s.bumpColumnMeta)
  const notify = useAppStore((s) => s.notify)
  const [mode, setMode] = useState<Mode>('lucide')
  const [name, setName] = useState('FolderOpen')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [colorText, setColorText] = useState(DEFAULT_COLOR)
  const [customB64, setCustomB64] = useState<string | null>(null)
  const [hasIcon, setHasIcon] = useState(false)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => filterLucideIcons(query), [query])
  const rowCount = Math.max(1, Math.ceil(filtered.length / COLS))
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CELL,
    overscan: 6
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await api.itemAds.getMany({ paths: [path] })
      if (cancelled || !res.ok) return
      const rec = res.value[path]
      const icon = rec?.icon
      if (!icon) return
      setHasIcon(true)
      if (icon.kind === 'lucide') {
        setMode('lucide')
        setName(icon.name)
        setColor(icon.color)
        setColorText(icon.color)
      } else if (icon.kind === 'shell') {
        setMode('shell')
        setColor(icon.color)
        setColorText(icon.color)
      } else {
        setMode('custom')
        if (rec?.iconPngBase64) setCustomB64(rec.iconPngBase64)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  const applyColor = (hex: string): void => {
    const n = normalizeHex(hex)
    if (!n) return
    setColor(n)
    setColorText(n)
  }

  const write = async (icon: ItemIcon | null, imageBase64?: string): Promise<void> => {
    setBusy(true)
    try {
      await call(api.itemAds.setIcon({ path, icon, imageBase64 }))
      bumpColumnMeta(path)
      closeDialog()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : 'Could not save the icon', true)
    } finally {
      setBusy(false)
    }
  }

  const apply = (): void => {
    if (mode === 'lucide') {
      if (!resolveLucideIcon(name)) return
      void write({ kind: 'lucide', name, color })
      return
    }
    if (mode === 'shell') {
      void write({ kind: 'shell', color })
      return
    }
    if (!customB64) return
    void write({ kind: 'custom', sizePx: 32 }, customB64)
  }

  const browse = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await call(api.itemAds.importCustomIcon({ path }))
      if (result.cancelled) return
      setCustomB64(result.imageBase64)
      setMode('custom')
    } catch (e) {
      notify(e instanceof IpcError ? e.message : 'Could not import that image', true)
    } finally {
      setBusy(false)
    }
  }

  const Preview = resolveLucideIcon(name)

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
    >
      <div className="modal modal-wide modal-tab-icon" role="dialog" aria-label="Set item icon">
        <div className="modal-title">Set icon — {basename(path)}</div>
        <div className="modal-body modal-body-tab-icon">
          <div className="item-icon-modes" role="tablist" aria-label="Icon source">
            {(
              [
                ['shell', 'Windows icon'],
                ['lucide', 'Lucide'],
                ['custom', 'Custom image']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={`btn${mode === id ? ' primary' : ''}`}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {mode !== 'custom' ? (
            <>
              <div className="tab-icon-picker-toolbar">
                <div className="tab-icon-picker-preview" aria-hidden>
                  {mode === 'lucide' && Preview
                    ? createElement(Preview, { size: 28, color, strokeWidth: 2 })
                    : (
                        <ShellTint color={color}>
                          <ShellIcon path={path} size={28} />
                        </ShellTint>
                      )}
                </div>
                <div className="tab-icon-picker-meta">
                  <div className="tab-icon-picker-name">
                    {mode === 'lucide' ? humanizeIconName(name) : 'Windows icon + tint'}
                  </div>
                  <div className="dim tab-icon-picker-pascal">
                    {mode === 'lucide'
                      ? name
                      : 'Keeps the Explorer glyph (including a folder.ico if set).'}
                  </div>
                </div>
                <label className="tab-icon-color-field">
                  <span className="dim">Color</span>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => applyColor(e.target.value)}
                    aria-label="Icon color"
                  />
                  <input
                    className="tab-icon-color-hex"
                    value={colorText}
                    spellCheck={false}
                    onChange={(e) => {
                      setColorText(e.target.value)
                      const n = normalizeHex(e.target.value)
                      if (n) setColor(n)
                    }}
                    onBlur={() => setColorText(color)}
                    aria-label="Icon color hex"
                  />
                </label>
              </div>
              <div className="tab-icon-presets" role="group" aria-label="Color presets">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`tab-icon-preset${c.toLowerCase() === color ? ' active' : ''}`}
                    style={{ background: c }}
                    title={c}
                    aria-label={`Color ${c}`}
                    onClick={() => applyColor(c)}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="tab-custom-icon-row">
              <div className="tab-custom-icon-preview" aria-hidden>
                {customB64 ? (
                  <img
                    src={`data:image/png;base64,${customB64}`}
                    width={48}
                    height={48}
                    alt=""
                    className="item-custom-icon"
                  />
                ) : (
                  <span className="dim">No image</span>
                )}
              </div>
              <div className="tab-custom-icon-meta">
                <p className="dim tab-custom-icon-hint">
                  Choose a .png, .jpg, or .ico. It is cover-cropped to a square and stored on the
                  item (not under the app data folder).
                </p>
                <button type="button" className="btn" onClick={() => void browse()} disabled={busy}>
                  {busy ? 'Importing…' : customB64 ? 'Change image…' : 'Choose image…'}
                </button>
              </div>
            </div>
          )}
          {mode === 'lucide' ? (
            <>
              <input
                className="tab-icon-search"
                type="search"
                placeholder="Search Lucide icons…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search icons"
              />
              <div className="tab-icon-grid-wrap" ref={scrollRef}>
                <div
                  className="tab-icon-grid-inner"
                  style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
                >
                  {virtualizer.getVirtualItems().map((row) => {
                    const start = row.index * COLS
                    const slice = filtered.slice(start, start + COLS)
                    return (
                      <div
                        key={row.key}
                        className="tab-icon-grid-row"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: CELL,
                          transform: `translateY(${row.start}px)`
                        }}
                      >
                        {slice.map((iconName) => {
                          const Icon = resolveLucideIcon(iconName)
                          if (!Icon) return null
                          const selected = iconName === name
                          return (
                            <button
                              key={iconName}
                              type="button"
                              className={`tab-icon-cell${selected ? ' selected' : ''}`}
                              title={humanizeIconName(iconName)}
                              aria-label={humanizeIconName(iconName)}
                              aria-pressed={selected}
                              onClick={() => setName(iconName)}
                              onDoubleClick={() => {
                                setName(iconName)
                                void write({ kind: 'lucide', name: iconName, color })
                              }}
                            >
                              {createElement(Icon, { size: 18, color, strokeWidth: 2 })}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn modal-action-start"
            onClick={() => void write(null)}
            disabled={busy || !hasIcon}
          >
            Clear icon
          </button>
          <button type="button" className="btn" onClick={closeDialog} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={apply}
            disabled={busy || (mode === 'lucide' && !Preview) || (mode === 'custom' && !customB64)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
