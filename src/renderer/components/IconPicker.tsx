import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ICON_PACK_IDS,
  ICON_PACK_LABELS,
  type IconPackId
} from '@shared/schemas/iconPack'
import {
  coerceIconNameForPack,
  filterPackIcons,
  humanizeIconName,
  packIconElement,
  resolvePackIcon
} from '../lib/iconPacks'

export const ICON_PICKER_COLS = 10
export const ICON_PICKER_CELL = 40
export const ICON_PICKER_DEFAULT_COLOR = '#60a5fa'

export const ICON_PICKER_PRESET_COLORS = [
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
] as const

export type IconPickerMode = 'shell' | 'glyph' | 'custom'

export type IconPickerGlyph = {
  pack: IconPackId
  name: string
  color: string
}

export function normalizeHex(raw: string): string | null {
  const s = raw.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase()
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s.toLowerCase()}`
  return null
}

export type IconPickerShellSlot = {
  label: string
  help: string
  preview: ReactNode
  /** When true, show color controls (item shell+tint). */
  showColor?: boolean
}

export type IconPickerCustomSlot = {
  hint: string
  preview: ReactNode
  browseLabel: string
  onBrowse: () => void
  busy?: boolean
}

/**
 * Shared icon picker body: mode tabs + shell / multi-pack glyph / custom slots.
 * Hosts own modal chrome and Apply/Cancel.
 */
export function IconPicker({
  modes,
  mode,
  onModeChange,
  glyph,
  onGlyphChange,
  shell,
  custom,
  modeLabels,
  onGlyphActivate
}: {
  modes: IconPickerMode[]
  mode: IconPickerMode
  onModeChange: (mode: IconPickerMode) => void
  glyph: IconPickerGlyph
  onGlyphChange: (next: IconPickerGlyph) => void
  /** Double-click a glyph cell (host may Apply immediately). */
  onGlyphActivate?: (glyph: IconPickerGlyph) => void
  shell?: IconPickerShellSlot
  custom?: IconPickerCustomSlot
  modeLabels?: Partial<Record<IconPickerMode, string>>
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [colorText, setColorText] = useState(glyph.color)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setColorText(glyph.color)
  }, [glyph.color])

  const filtered = useMemo(
    () => filterPackIcons(glyph.pack, query),
    [glyph.pack, query]
  )
  const rowCount = Math.max(1, Math.ceil(filtered.length / ICON_PICKER_COLS))
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ICON_PICKER_CELL,
    overscan: 6
  })

  useEffect(() => {
    const idx = filtered.indexOf(glyph.name)
    if (idx < 0) return
    virtualizer.scrollToIndex(Math.floor(idx / ICON_PICKER_COLS), { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when filter list changes
  }, [filtered])

  const applyColor = (hex: string): void => {
    const n = normalizeHex(hex)
    if (!n) return
    onGlyphChange({ ...glyph, color: n })
    setColorText(n)
  }

  const setPack = (pack: IconPackId): void => {
    if (pack === glyph.pack) return
    const name = coerceIconNameForPack(pack, glyph.name)
    onGlyphChange({ ...glyph, pack, name })
  }

  const labels: Record<IconPickerMode, string> = {
    shell: modeLabels?.shell ?? 'Windows icon',
    glyph: modeLabels?.glyph ?? 'Glyph',
    custom: modeLabels?.custom ?? 'Custom image'
  }

  const showColor =
    mode === 'glyph' || (mode === 'shell' && shell?.showColor === true)

  const Preview =
    mode === 'glyph' ? packIconElement(glyph.pack, glyph.name, { size: 28, color: glyph.color, strokeWidth: 2 }) : null

  return (
    <>
      {modes.length > 1 ? (
        <div className="item-icon-modes" role="tablist" aria-label="Icon source">
          {modes.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={`btn${mode === id ? ' primary' : ''}`}
              onClick={() => onModeChange(id)}
            >
              {labels[id]}
            </button>
          ))}
        </div>
      ) : null}

      {mode === 'shell' && shell ? (
        <div className="tab-icon-picker-toolbar">
          <div className="tab-icon-picker-preview" aria-hidden>
            {shell.preview}
          </div>
          <div className="tab-icon-picker-meta">
            <div className="tab-icon-picker-name">{shell.label}</div>
            <div className="dim tab-icon-picker-pascal">{shell.help}</div>
          </div>
          {shell.showColor ? (
            <ColorField color={glyph.color} colorText={colorText} setColorText={setColorText} applyColor={applyColor} />
          ) : null}
        </div>
      ) : null}

      {mode === 'glyph' ? (
        <>
          <div className="tab-icon-picker-toolbar">
            <div className="tab-icon-picker-preview" aria-hidden>
              {Preview ?? <span className="dim">?</span>}
            </div>
            <div className="tab-icon-picker-meta">
              <div className="tab-icon-picker-name">{humanizeIconName(glyph.name)}</div>
              <div className="dim tab-icon-picker-pascal">{glyph.name}</div>
            </div>
            <ColorField color={glyph.color} colorText={colorText} setColorText={setColorText} applyColor={applyColor} />
          </div>
          <div className="icon-pack-tabs" role="tablist" aria-label="Icon pack">
            {ICON_PACK_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={glyph.pack === id}
                className={`btn btn-small${glyph.pack === id ? ' primary' : ''}`}
                onClick={() => setPack(id)}
              >
                {ICON_PACK_LABELS[id]}
              </button>
            ))}
          </div>
          <ColorPresets color={glyph.color} applyColor={applyColor} />
          <input
            className="tab-icon-search"
            type="search"
            placeholder={`Search ${ICON_PACK_LABELS[glyph.pack]} icons…`}
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
                const start = row.index * ICON_PICKER_COLS
                const slice = filtered.slice(start, start + ICON_PICKER_COLS)
                return (
                  <div
                    key={row.key}
                    className="tab-icon-grid-row"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: ICON_PICKER_CELL,
                      transform: `translateY(${row.start}px)`
                    }}
                  >
                    {slice.map((iconName) => {
                      const el = packIconElement(glyph.pack, iconName, {
                        size: 18,
                        color: glyph.color,
                        strokeWidth: 2
                      })
                      if (!el) return null
                      const selected = iconName === glyph.name
                      return (
                        <button
                          key={iconName}
                          type="button"
                          className={`tab-icon-cell${selected ? ' selected' : ''}`}
                          title={humanizeIconName(iconName)}
                          aria-label={humanizeIconName(iconName)}
                          aria-pressed={selected}
                          onClick={() => onGlyphChange({ ...glyph, name: iconName })}
                          onDoubleClick={() => {
                            const next = { ...glyph, name: iconName }
                            onGlyphChange(next)
                            onGlyphActivate?.(next)
                          }}
                          data-icon-name={iconName}
                        >
                          {el}
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
            {query.trim() ? ' matching' : ` in ${ICON_PACK_LABELS[glyph.pack]}`}
          </div>
        </>
      ) : null}

      {mode === 'custom' && custom ? (
        <div className="tab-custom-icon-row">
          <div className="tab-custom-icon-preview" aria-hidden>
            {custom.preview}
          </div>
          <div className="tab-custom-icon-meta">
            <p className="dim tab-custom-icon-hint">{custom.hint}</p>
            <button
              type="button"
              className="btn"
              onClick={custom.onBrowse}
              disabled={custom.busy}
            >
              {custom.browseLabel}
            </button>
          </div>
        </div>
      ) : null}

      {showColor && mode === 'shell' ? <ColorPresets color={glyph.color} applyColor={applyColor} /> : null}
    </>
  )
}

function ColorField({
  color,
  colorText,
  setColorText,
  applyColor
}: {
  color: string
  colorText: string
  setColorText: (v: string) => void
  applyColor: (hex: string) => void
}): JSX.Element {
  return (
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
          if (n) applyColor(n)
        }}
        onBlur={() => setColorText(color)}
        aria-label="Icon color hex"
      />
    </label>
  )
}

function ColorPresets({
  color,
  applyColor
}: {
  color: string
  applyColor: (hex: string) => void
}): JSX.Element {
  return (
    <div className="tab-icon-presets" role="group" aria-label="Color presets">
      {ICON_PICKER_PRESET_COLORS.map((c) => (
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
  )
}

export function glyphIsResolvable(glyph: IconPickerGlyph): boolean {
  return resolvePackIcon(glyph.pack, glyph.name) != null
}
