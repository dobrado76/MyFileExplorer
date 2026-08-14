import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/appStore'
import {
  segmentsOf,
  looksAbsolute,
  normalizeSlashes,
  stripTrailingSep,
  isUnderPath
} from '../lib/paths'
import { api, call } from '../lib/ipc'
import { ChevronDown, ChevronRight } from '../lib/icons'
import { historyEntries, type RecentLocation } from '../lib/historyEntries'
import { folderHistory, searchHistory } from '@shared/tabHistory'

const isWindows =
  (globalThis as typeof globalThis & { process?: { platform?: string } }).process?.platform ===
  'win32'

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
  const goToHistoryEntry = useAppStore((s) => s.goToHistoryEntry)
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
  const trailRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const historyBtnRef = useRef<HTMLButtonElement>(null)
  /** Middle segment indices [start, end) hidden behind … — only when the full trail overflows. */
  const [hiddenRange, setHiddenRange] = useState<{ start: number; end: number } | null>(null)

  const searching = Boolean(tab?.search.active && tab.search.query.trim())
  const history = useMemo(() => {
    const current =
      searching && tab
        ? searchHistory(tab.search.query.trim(), path, tab.search.indexedOnly)
        : folderHistory(path)
    return historyEntries(back ?? [], current, forward ?? [])
  }, [back, path, forward, searching, tab])

  useEffect(() => {
    if (editing) {
      // Display POSIX-style on non-Windows, but keep internal `path` unchanged.
      setText(isWindows ? path : path.replace(/\\\\/g, '/'))
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
      if (looksAbsolute(raw) && raw.toLowerCase().startsWith('mfe-remote://')) {
        await navigate(raw, { tabId })
        return
      }
      const expanded = (await call(api.app.expandPath({ path: raw }))).path
      const target = stripTrailingSep(normalizeSlashes(expanded))
      if (!target || !looksAbsolute(target)) {
        notify(
          'Enter an absolute path like /home/user/folder, C:\\folder, smb://server/share, mfe-remote://…, or %LOCALAPPDATA%\\…',
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

  const segments = useMemo(() => {
    const all = segmentsOf(path)
    return rootPath ? all.filter((seg) => isUnderPath(seg.path, rootPath)) : all
  }, [path, rootPath])

  useLayoutEffect(() => {
    setHiddenRange(null)
    setOverflowOpen(false)
  }, [path])

  useLayoutEffect(() => {
    if (editing) return
    const trail = trailRef.current
    const measure = measureRef.current
    if (!trail || !measure) return

    const recompute = (): void => {
      const n = segments.length
      if (n <= 2) {
        setHiddenRange(null)
        return
      }

      const available = trail.clientWidth
      if (available <= 0) return

      const crumbEls = measure.querySelectorAll<HTMLElement>('[data-crumb-i]')
      const sepEl = measure.querySelector<HTMLElement>('[data-crumb-sep]')
      const overflowEl = measure.querySelector<HTMLElement>('[data-crumb-overflow-measure]')
      if (crumbEls.length !== n) return

      const widths: number[] = []
      for (let i = 0; i < n; i++) {
        widths.push(crumbEls[i]?.offsetWidth ?? 0)
      }
      const sepW = sepEl?.offsetWidth ?? 12
      const overflowW = overflowEl?.offsetWidth ?? 28

      let full = 0
      for (let i = 0; i < n; i++) {
        full += widths[i] ?? 0
        if (i < n - 1) full += sepW
      }
      if (full <= available + 0.5) {
        setHiddenRange((prev) => (prev == null ? prev : null))
        return
      }

      // Keep first + last; grow the visible tail leftward while space remains.
      let used = (widths[0] ?? 0) + sepW + overflowW + sepW + (widths[n - 1] ?? 0)
      let keepFrom = n - 1
      for (let i = n - 2; i >= 1; i--) {
        const next = used + sepW + (widths[i] ?? 0)
        if (next <= available + 0.5) {
          used = next
          keepFrom = i
        } else {
          break
        }
      }

      const start = 1
      const end = keepFrom
      if (end <= start) {
        setHiddenRange(n > 2 ? { start: 1, end: n - 1 } : null)
        return
      }
      setHiddenRange((prev) =>
        prev && prev.start === start && prev.end === end ? prev : { start, end }
      )
    }

    recompute()
    const ro = new ResizeObserver(() => recompute())
    ro.observe(trail)
    if (rootRef.current) ro.observe(rootRef.current)
    return () => ro.disconnect()
  }, [segments, editing])

  const historyMenu =
    historyOpen && menuPos
      ? createPortal(
          <HistoryMenu
            top={menuPos.top}
            left={menuPos.left}
            width={menuPos.width}
            items={history}
            canClear={canClearHistory}
            onPick={(item) => {
              setHistoryOpen(false)
              setEditing(false)
              if (item.current) return
              void goToHistoryEntry(item.entry, tabId)
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

  const hidden =
    hiddenRange != null ? segments.slice(hiddenRange.start, hiddenRange.end) : []
  const head = hiddenRange != null ? segments.slice(0, 1) : []
  const visible =
    hiddenRange != null ? segments.slice(hiddenRange.end) : segments

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
      {/* Off-layout full trail used only to measure natural crumb widths. */}
      <div className="breadcrumb-measure" ref={measureRef} aria-hidden>
        {segments.map((seg, i) => (
          <span key={`m-${seg.path}`} style={{ display: 'contents' }}>
            <button type="button" className="crumb" data-crumb-i={i} tabIndex={-1}>
              {seg.label}
            </button>
            {i < segments.length - 1 && (
              <span className="crumb-sep" data-crumb-sep={i === 0 ? '' : undefined}>
                <ChevronRight size={12} />
              </span>
            )}
          </span>
        ))}
        <button type="button" className="crumb-overflow" data-crumb-overflow-measure tabIndex={-1}>
          …
        </button>
      </div>
      <div className="breadcrumb-trail" ref={trailRef}>
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
            {(i < visible.length - 1 || searching) && (
              <span className="crumb-sep">
                <ChevronRight size={12} />
              </span>
            )}
          </span>
        ))}
        {searching && tab && (
          <span className="crumb crumb-search" title={`Search: ${tab.search.query.trim()}`}>
            Search: {tab.search.query.trim()}
          </span>
        )}
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
  items: RecentLocation[]
  canClear: boolean
  onPick: (item: RecentLocation) => void
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
            key={item.key}
            type="button"
            role="option"
            aria-selected={item.current}
            className={`menu-item${item.current ? ' current' : ''}`}
            title={item.label}
            onClick={() => onPick(item)}
          >
            <span className="menu-check">{item.current ? '✓' : ''}</span>
            <span className="crumb-history-label">{item.label}</span>
            <span className="crumb-history-path">
              {isWindows ? item.path : item.path.replace(/\\\\/g, '/')}
            </span>
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
