import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../store/appStore'
import { ChevronDown } from '../lib/icons'

const TYPE_CHIPS: { label: string; insert: string; title: string }[] = [
  { label: 'Folder', insert: 'folder:', title: 'Insert folder: — folders only' },
  { label: 'Picture', insert: 'pic:', title: 'Insert pic: — image types (jpg, png, …)' },
  { label: 'Video', insert: 'video:', title: 'Insert video: — video types (mp4, mkv, …)' },
  { label: 'Audio', insert: 'audio:', title: 'Insert audio: — audio types (mp3, flac, …)' },
  { label: 'Document', insert: 'doc:', title: 'Insert doc: — documents (pdf, docx, …)' },
  { label: 'Executable', insert: 'exe:', title: 'Insert exe: — executables and installers' },
  { label: 'Archive', insert: 'zip:', title: 'Insert zip: — archives (zip, 7z, rar, …)' }
]

/** Popover for search scope + match options (keeps the search field clean). */
export function SearchOptionsMenu(): JSX.Element {
  const search = useAppStore((s) => s.search)
  const settings = useAppStore((s) => s.settings)
  const setSearchIndexedOnly = useAppStore((s) => s.setSearchIndexedOnly)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const runSearch = useAppStore((s) => s.runSearch)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)

  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const activeCount =
    (search.indexedOnly ? 1 : 0) +
    (settings.searchMatchPath ? 1 : 0) +
    (settings.searchMatchCase ? 1 : 0) +
    (settings.searchWholeWord ? 1 : 0) +
    (settings.searchRegex ? 1 : 0) +
    (settings.searchShowHidden ? 1 : 0)

  useEffect(() => {
    if (!open) {
      setMenuPos(null)
      return
    }
    const place = (): void => {
      const btn = btnRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const width = 280
      let left = r.right - width
      if (left < 8) left = 8
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
      setMenuPos({ top: r.bottom + 4, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (btnRef.current?.contains(t)) return
      if (t instanceof Element && t.closest('.search-options-panel')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDoc, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const patchMatch = (
    key: 'searchMatchPath' | 'searchMatchCase' | 'searchWholeWord' | 'searchRegex' | 'searchShowHidden',
    v: boolean
  ): void => {
    void applySettingsPatch({ [key]: v }).then(() => {
      if (search.query.trim()) void runSearch()
    })
  }

  const insertChip = (token: string): void => {
    const q = search.query.trim()
    const next = q ? `${q} ${token}` : token
    setSearchQuery(next)
    setOpen(false)
    // setSearchQuery already debounces runSearch
  }

  const summary = search.indexedOnly ? 'Indexed' : 'Folder'
  const matchExtra = activeCount - (search.indexedOnly ? 1 : 0)
  const title =
    matchExtra > 0
      ? `Search options — ${summary}, ${matchExtra} match option${matchExtra === 1 ? '' : 's'} on`
      : `Search options — ${summary} scope`

  const menu =
    open && menuPos
      ? createPortal(
          <div
            className="context-menu search-options-panel"
            role="dialog"
            aria-label="Search options"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 280 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="menu-hint">Scope</div>
            <label
              className="search-options-row"
              title="On: search indexed roots. Off: current folder and subfolders (index still used when that folder is covered)."
            >
              <input
                type="checkbox"
                checked={search.indexedOnly}
                onChange={(e) => setSearchIndexedOnly(e.target.checked)}
              />
              <span>Search indexed roots</span>
            </label>

            <div className="menu-hint">Match</div>
            <label
              className="search-options-row"
              title="Also match the full path, not just the file name. Same as path: in the query."
            >
              <input
                type="checkbox"
                checked={settings.searchMatchPath}
                onChange={(e) => patchMatch('searchMatchPath', e.target.checked)}
              />
              <span>Match path</span>
            </label>
            <label
              className="search-options-row"
              title="Case-sensitive names. Same as case: in the query."
            >
              <input
                type="checkbox"
                checked={settings.searchMatchCase}
                onChange={(e) => patchMatch('searchMatchCase', e.target.checked)}
              />
              <span>Match case</span>
            </label>
            <label
              className="search-options-row"
              title="Match whole words only. Same as ww: in the query."
            >
              <input
                type="checkbox"
                checked={settings.searchWholeWord}
                onChange={(e) => patchMatch('searchWholeWord', e.target.checked)}
              />
              <span>Whole word</span>
            </label>
            <label
              className="search-options-row"
              title="Treat the query as a regular expression. Same as regex: in the query."
            >
              <input
                type="checkbox"
                checked={settings.searchRegex}
                onChange={(e) => patchMatch('searchRegex', e.target.checked)}
              />
              <span>Regular expression</span>
            </label>
            <label
              className="search-options-row"
              title="On: find and show Hidden / !VIDTHUMB_CACHE (view filter does not hide hits). Off: omit Hidden from the search, and the toolbar view filter still applies to results when the eye is on. attrib:h still finds Hidden."
            >
              <input
                type="checkbox"
                checked={settings.searchShowHidden}
                onChange={(e) => patchMatch('searchShowHidden', e.target.checked)}
              />
              <span>Show hidden</span>
            </label>

            <div className="menu-hint">Type filters</div>
            <div className="search-options-chips">
              {TYPE_CHIPS.map((c) => (
                <button
                  key={c.insert}
                  type="button"
                  className="search-options-chip"
                  title={c.title}
                  onClick={() => insertChip(c.insert)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <div className="search-options-menu">
      <button
        ref={btnRef}
        type="button"
        className={`search-options-btn${open ? ' open' : ''}${activeCount > 0 ? ' active' : ''}`}
        aria-label="Search options"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="search-options-label">{summary}</span>
        {activeCount > (search.indexedOnly ? 1 : 0) ? (
          <span className="search-options-badge">{activeCount - (search.indexedOnly ? 1 : 0)}</span>
        ) : null}
        <ChevronDown size={12} />
      </button>
      {menu}
    </div>
  )
}
