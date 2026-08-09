import { createElement, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppStore } from '../store/appStore'
import {
  filterLucideIcons,
  humanizeIconName,
  resolveLucideIcon
} from '../lib/lucideIcons'

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

export function TabIconPickerDialog({ tabId }: { tabId: string }): JSX.Element | null {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === tabId))
  const setTabIcon = useAppStore((s) => s.setTabIcon)
  const closeDialog = useAppStore((s) => s.closeDialog)

  const [query, setQuery] = useState('')
  const [name, setName] = useState(tab?.icon?.name ?? 'FolderOpen')
  const [color, setColor] = useState(tab?.icon?.color ?? DEFAULT_COLOR)
  const [colorText, setColorText] = useState(tab?.icon?.color ?? DEFAULT_COLOR)
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
    if (!tab) closeDialog()
  }, [tab, closeDialog])

  // Scroll selected icon into view when opening / filtering.
  useEffect(() => {
    const idx = filtered.indexOf(name)
    if (idx < 0) return
    virtualizer.scrollToIndex(Math.floor(idx / COLS), { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when filter list changes
  }, [filtered])

  if (!tab) return null

  const Preview = resolveLucideIcon(name)
  const applyColor = (hex: string): void => {
    const n = normalizeHex(hex)
    if (!n) return
    setColor(n)
    setColorText(n)
  }

  const apply = (): void => {
    if (!resolveLucideIcon(name)) return
    setTabIcon(tabId, { name, color })
    closeDialog()
  }

  const clear = (): void => {
    setTabIcon(tabId, null)
    closeDialog()
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
    >
      <div className="modal modal-wide modal-tab-icon" role="dialog" aria-label="Set tab icon">
        <div className="modal-title">Set tab icon</div>
        <div className="modal-body modal-body-tab-icon">
          <div className="tab-icon-picker-toolbar">
            <div className="tab-icon-picker-preview" aria-hidden>
              {Preview
                ? createElement(Preview, { size: 28, color, strokeWidth: 2 })
                : (
                    <span className="dim">?</span>
                  )}
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
            autoFocus
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
                            setTabIcon(tabId, { name: iconName, color })
                            closeDialog()
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
          <div className="dim tab-icon-count">
            {filtered.length.toLocaleString()} icon{filtered.length === 1 ? '' : 's'}
            {query.trim() ? ' matching' : ' in Lucide'}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={clear} disabled={!tab.icon}>
            Clear icon
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={apply} disabled={!Preview}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
