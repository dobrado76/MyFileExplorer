import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/appStore'
import {
  segmentsOf,
  looksAbsolute,
  normalizeSlashes,
  stripTrailingSep,
  isUnderPath,
  basename,
  samePath
} from '../lib/paths'
import { api, call } from '../lib/ipc'
import { ChevronDown, ChevronRight } from '../lib/icons'
import { historyEntries } from '../lib/historyEntries'

type Props = {
  /** Bind to a specific tab (pane toolbar). Default: active tab + global address editing. */
  tabId?: string
}

export function Breadcrumb({ tabId: tabIdProp }: Props = {}): JSX.Element {
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tabId = tabIdProp ?? activeTabId
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === tabId))
  const path = tab?.path ?? ''
  const rootPath = tab?.rootPath ?? null
  const back = tab?.back
  const forward = tab?.forward
  const addressEditing = useAppStore((s) => s.addressEditing)
  const setAddressEditing = useAppStore((s) => s.setAddressEditing)
  const navigate = useAppStore((s) => s.navigate)
  const notify = useAppStore((s) => s.notify)

  const [localEditing, setLocalEditing] = useState(false)
  const editing = tabIdProp ? localEditing : addressEditing && tabId === activeTabId
  const setEditing = (v: boolean): void => {
    if (tabIdProp) setLocalEditing(v)
    else setAddressEditing(v)
  }

  const [text, setText] = useState(path)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const historyBtnRef = useRef<HTMLButtonElement>(null)

  const history = useMemo(
    () => historyEntries(back ?? [], path, forward ?? []),
    [back, path, forward]
  )

  useEffect(() => {
    if (editing) {
      setText(path)
      setHistoryOpen(false)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, path])

  useLayoutEffect(() => {
    if (!historyOpen) {
      setMenuPos(null)
      return
    }
    const place = (): void => {
      const btn = historyBtnRef.current
      const bar = rootRef.current
      if (!btn || !bar) return
      const br = bar.getBoundingClientRect()
      const btnR = btn.getBoundingClientRect()
      const width = Math.max(280, Math.min(window.innerWidth - 16, br.width))
      let left = br.left
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width
      if (left < 8) left = 8
      setMenuPos({ top: btnR.bottom + 2, left, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [historyOpen])

  useEffect(() => {
    if (!historyOpen) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (historyBtnRef.current?.contains(t)) return
      if ((t as Element).closest?.('.crumb-history-menu')) return
      setHistoryOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setHistoryOpen(false)
    }
    document.addEventListener('mousedown', onDoc, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [historyOpen])

  const go = (target: string): void => {
    void navigate(target, { tabId })
  }

  const toggleHistory = (e: React.MouseEvent): void => {
    e.stopPropagation()
    e.preventDefault()
    setOverflowOpen(false)
    setHistoryOpen((v) => !v)
  }

  const submit = async (): Promise<void> => {
    setEditing(false)
    const raw = text.trim()
    if (!raw) return
    try {
      const expanded = (await call(api.app.expandPath({ path: raw }))).path
      const target = stripTrailingSep(normalizeSlashes(expanded))
      if (!target || !looksAbsolute(target)) {
        notify(
          'Enter an absolute path like C:\\folder, \\\\server\\share, or %LOCALAPPDATA%\\…',
          true
        )
        return
      }
      const { exists } = await call(api.fs.exists({ path: target }))
      if (!exists) {
        notify(`Path not found: ${target}`, true)
        return
      }
      await navigate(target, { tabId })
    } catch {
      notify(`Cannot open: ${raw}`, true)
    }
  }

  const clearHistory = useAppStore((s) => s.clearHistory)
  const canClearHistory = (back?.length ?? 0) > 0 || (forward?.length ?? 0) > 0

  const historyMenu =
    historyOpen && menuPos
      ? createPortal(
          <HistoryMenu
            top={menuPos.top}
            left={menuPos.left}
            width={menuPos.width}
            items={history}
            canClear={canClearHistory}
            onPick={(p) => {
              setHistoryOpen(false)
              setEditing(false)
              if (!samePath(p, path)) go(p)
            }}
            onClear={() => {
              setHistoryOpen(false)
              clearHistory(tabId)
            }}
          />,
          document.body
        )
      : null

  if (editing) {
    return (
      <div className="breadcrumb" ref={rootRef}>
        <input
          ref={inputRef}
          className="address-input"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') setEditing(false)
            e.stopPropagation()
          }}
          onBlur={() => setEditing(false)}
          aria-label="Address"
        />
        <button
          type="button"
          ref={historyBtnRef}
          className="crumb-history-btn"
          aria-label="Recent locations"
          aria-expanded={historyOpen}
          aria-haspopup="listbox"
          disabled={!path}
          title="Recent locations"
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleHistory}
        >
          <ChevronDown size={14} />
        </button>
        {historyMenu}
      </div>
    )
  }

  const segments = rootPath
    ? segmentsOf(path).filter((seg) => isUnderPath(seg.path, rootPath))
    : segmentsOf(path)
  const MAX_VISIBLE = 5
  const collapsed = segments.length > MAX_VISIBLE
  const head = collapsed ? segments.slice(0, 1) : []
  const hidden = collapsed ? segments.slice(1, segments.length - (MAX_VISIBLE - 2)) : []
  const visible = collapsed ? segments.slice(segments.length - (MAX_VISIBLE - 2)) : segments

  return (
    <div
      ref={rootRef}
      className="breadcrumb"
      onClick={(e) => {
        const t = e.target as HTMLElement
        // Explorer: click empty address area → edit; crumb / overflow / history keep their own actions.
        if (t.closest('.crumb, .crumb-overflow, .crumb-history-btn, .crumb-history-menu, .context-menu')) {
          return
        }
        setEditing(true)
      }}
      title="Click empty area or Ctrl+L to type a path"
    >
      <div className="breadcrumb-trail">
        {head.map((seg) => (
          <span key={seg.path} style={{ display: 'contents' }}>
            <button type="button" className="crumb" onClick={() => go(seg.path)}>
              {seg.label}
            </button>
            <span className="crumb-sep">
              <ChevronRight size={12} />
            </span>
          </span>
        ))}
        {hidden.length > 0 && (
          <span style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
            <button
              type="button"
              className="crumb-overflow"
              onClick={() => setOverflowOpen((v) => !v)}
              aria-label="Show hidden path segments"
            >
              …
            </button>
            {overflowOpen && (
              <div
                className="context-menu"
                style={{ position: 'absolute', top: '100%', left: 0 }}
                onMouseLeave={() => setOverflowOpen(false)}
              >
                {hidden.map((seg) => (
                  <button
                    key={seg.path}
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      setOverflowOpen(false)
                      go(seg.path)
                    }}
                  >
                    {seg.label}
                  </button>
                ))}
              </div>
            )}
            <span className="crumb-sep">
              <ChevronRight size={12} />
            </span>
          </span>
        )}
        {visible.map((seg, i) => (
          <span key={seg.path} style={{ display: 'contents' }}>
            <button type="button" className="crumb" onClick={() => go(seg.path)}>
              {seg.label}
            </button>
            {i < visible.length - 1 && (
              <span className="crumb-sep">
                <ChevronRight size={12} />
              </span>
            )}
          </span>
        ))}
      </div>
      <button
        type="button"
        ref={historyBtnRef}
        className="crumb-history-btn"
        aria-label="Recent locations"
        aria-expanded={historyOpen}
        aria-haspopup="listbox"
        disabled={!path}
        title="Recent locations"
        onClick={toggleHistory}
      >
        <ChevronDown size={14} />
      </button>
      {historyMenu}
    </div>
  )
}

function HistoryMenu({
  top,
  left,
  width,
  items,
  canClear,
  onPick,
  onClear
}: {
  top: number
  left: number
  width: number
  items: { path: string; current: boolean }[]
  canClear: boolean
  onPick: (path: string) => void
  onClear: () => void
}): JSX.Element {
  return (
    <div
      className="context-menu crumb-history-menu"
      role="listbox"
      aria-label="Recent locations"
      style={{ top, left, width, position: 'fixed' }}
    >
      <div className="menu-hint">Recent locations</div>
      {items.length === 0 ? (
        <div className="menu-item" style={{ opacity: 0.6, pointerEvents: 'none' }}>
          No locations yet
        </div>
      ) : (
        items.map((item) => (
          <button
            key={item.path}
            type="button"
            role="option"
            aria-selected={item.current}
            className={`menu-item${item.current ? ' current' : ''}`}
            title={item.path}
            onClick={() => onPick(item.path)}
          >
            <span className="menu-check">{item.current ? '✓' : ''}</span>
            <span className="crumb-history-label">{basename(item.path)}</span>
            <span className="crumb-history-path">{item.path}</span>
          </button>
        ))
      )}
      <div className="menu-sep" />
      <button
        type="button"
        className="menu-item"
        disabled={!canClear}
        onClick={onClear}
      >
        Clear history…
      </button>
    </div>
  )
}
