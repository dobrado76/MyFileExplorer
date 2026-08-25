import { createElement, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  QUICK_LAUNCH_LUCIDE_COLOR,
  type QuickLaunchIconKind,
  type QuickLaunchItem
} from '@shared/schemas/quickLaunch'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { filterLucideIcons, humanizeIconName, resolveLucideIcon } from '../lib/lucideIcons'
import { cacheQuickLaunchIconUrl, QuickLaunchIcon } from './QuickLaunchIcon'
import { ShellIcon } from './ShellIcon'

const COLS = 10
const CELL = 40
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

export type QuickLaunchIconPatch = {
  iconKind: QuickLaunchIconKind
  iconId?: string
  lucideName?: string
  lucideColor: string
}

export function QuickLaunchIconPicker({
  item,
  onClose,
  onApply
}: {
  item: QuickLaunchItem
  onClose: () => void
  onApply: (patch: QuickLaunchIconPatch) => void
}): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const [mode, setMode] = useState<QuickLaunchIconKind>(item.iconKind)
  const [name, setName] = useState(item.lucideName ?? 'AppWindow')
  const [color, setColor] = useState(item.lucideColor || QUICK_LAUNCH_LUCIDE_COLOR)
  const [colorText, setColorText] = useState(item.lucideColor || QUICK_LAUNCH_LUCIDE_COLOR)
  const [customId, setCustomId] = useState(item.iconKind === 'custom' ? item.iconId : undefined)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [resolvedPath, setResolvedPath] = useState(item.path)
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
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    if (!/%[A-Za-z0-9_]+%/.test(item.path)) {
      setResolvedPath(item.path)
      return
    }
    let live = true
    void call(api.app.expandPath({ path: item.path }))
      .then((r) => {
        if (live) setResolvedPath(r.path)
      })
      .catch(() => {
        if (live) setResolvedPath(item.path)
      })
    return () => {
      live = false
    }
  }, [item.path])

  const applyColor = (hex: string): void => {
    const n = normalizeHex(hex)
    if (!n) return
    setColor(n)
    setColorText(n)
  }

  const browse = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await call(api.quickLaunch.importIcon())
      if (res.cancelled) return
      cacheQuickLaunchIconUrl(res.id, res.mediaUrl)
      if (customId && customId !== res.id) {
        void call(api.quickLaunch.deleteIcon({ id: customId })).catch(() => {})
      }
      setCustomId(res.id)
      setMode('custom')
    } catch (e) {
      notify(e instanceof IpcError ? e.message : 'Could not set icon', true)
    } finally {
      setBusy(false)
    }
  }

  const deleteIcons = (...ids: Array<string | undefined>): void => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      void call(api.quickLaunch.deleteIcon({ id })).catch(() => {})
    }
  }

  const apply = (): void => {
    if (mode === 'lucide') {
      if (!resolveLucideIcon(name)) return
      deleteIcons(item.iconKind === 'custom' ? item.iconId : undefined, customId)
      onApply({ iconKind: 'lucide', lucideName: name, lucideColor: color })
      return
    }
    if (mode === 'shell') {
      deleteIcons(item.iconKind === 'custom' ? item.iconId : undefined, customId)
      onApply({ iconKind: 'shell', lucideColor: color })
      return
    }
    if (!customId) return
    if (item.iconKind === 'custom' && item.iconId && item.iconId !== customId) {
      deleteIcons(item.iconId)
    }
    onApply({ iconKind: 'custom', iconId: customId, lucideColor: color })
  }

  const Preview = resolveLucideIcon(name)
  const previewItem: QuickLaunchItem = {
    ...item,
    iconKind: 'custom',
    iconId: customId
  }

  return createPortal(
    <div
      className="modal-backdrop quick-launch-icon-picker-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-wide modal-tab-icon" role="dialog" aria-label="Quick Launch icon">
        <div className="modal-title">Set icon — {item.name}</div>
        <div className="modal-body modal-body-tab-icon">
          <div className="item-icon-modes" role="tablist" aria-label="Icon source">
            {(
              [
                ['shell', 'App icon'],
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
          {mode === 'shell' ? (
            <div className="tab-icon-picker-toolbar">
              <div className="tab-icon-picker-preview" aria-hidden>
                <ShellIcon path={resolvedPath} size={28} />
              </div>
              <div className="tab-icon-picker-meta">
                <div className="tab-icon-picker-name">Windows program icon</div>
                <div className="dim tab-icon-picker-pascal">
                  Uses the .exe or shortcut glyph from Explorer.
                </div>
              </div>
            </div>
          ) : null}
          {mode === 'lucide' ? (
            <>
              <div className="tab-icon-picker-toolbar">
                <div className="tab-icon-picker-preview" aria-hidden>
                  {Preview
                    ? createElement(Preview, { size: 28, color, strokeWidth: 2 })
                    : null}
                </div>
                <div className="tab-icon-picker-meta">
                  <div className="tab-icon-picker-name">{humanizeIconName(name)}</div>
                  <div className="dim tab-icon-picker-pascal">{name}</div>
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
                                deleteIcons(
                                  item.iconKind === 'custom' ? item.iconId : undefined,
                                  customId
                                )
                                onApply({
                                  iconKind: 'lucide',
                                  lucideName: iconName,
                                  lucideColor: color
                                })
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
          {mode === 'custom' ? (
            <div className="tab-custom-icon-row">
              <div className="tab-custom-icon-preview" aria-hidden>
                {customId ? (
                  <QuickLaunchIcon item={previewItem} size={48} />
                ) : (
                  <span className="dim">No image</span>
                )}
              </div>
              <div className="tab-custom-icon-meta">
                <p className="dim tab-custom-icon-hint">
                  Choose a .png, .jpg, or .ico. It is cover-cropped to a square and stored on this
                  PC (not in Settings export).
                </p>
                <button type="button" className="btn" onClick={() => void browse()} disabled={busy}>
                  {busy ? 'Importing…' : customId ? 'Change image…' : 'Choose image…'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={apply}
            disabled={busy || (mode === 'lucide' && !Preview) || (mode === 'custom' && !customId)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
