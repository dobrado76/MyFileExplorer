import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import {
  compiledLastTxtPath,
  compiledListsDir
} from '@shared/slideshow/compiledLists'
import {
  EraserIcon,
  FolderOpenIcon,
  PlayIcon,
  RefreshIcon,
  SaveIcon
} from '../lib/icons'
import { api, call } from '../lib/ipc'

type DatRow = {
  path: string
  name: string
  kind: 'dat' | 'txt'
  fileCount: number
  indexPresent: boolean
  count: number
}

type TabData = { name: string; rows: DatRow[] }

function formatNb(n: number): string {
  return n.toLocaleString()
}

/**
 * Detached Compiled Lists window — tabs of .dat rows, Load/Save !!Lists composites,
 * live playlist rebuild while slideshow runs. last.txt is always kept in sync for resume;
 * Save can also write additional named .txt files under !!Lists/.
 */
export function CompiledListsWindowApp(): JSX.Element {
  const [compiledRoot, setCompiledRoot] = useState('')
  const [entries, setEntries] = useState<{ name: string; folder: string }[]>([])
  const [tabs, setTabs] = useState<TabData[]>([])
  const [activeTab, setActiveTab] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [playing, setPlaying] = useState(false)

  const listsDir = useMemo(
    () => (compiledRoot ? compiledListsDir(compiledRoot) : ''),
    [compiledRoot]
  )

  const applyCounts = useCallback((tabList: TabData[], lines: { datPath: string; count: number }[]) => {
    const map = new Map(lines.map((l) => [l.datPath.toLowerCase(), l.count]))
    return tabList.map((t) => ({
      ...t,
      rows: t.rows.map((r) => ({
        ...r,
        count: map.get(r.path.toLowerCase()) ?? 0
      }))
    }))
  }, [])

  const collectLines = useCallback((): { datPath: string; count: number }[] => {
    const lines: { datPath: string; count: number }[] = []
    for (const t of tabs) {
      for (const r of t.rows) {
        if (r.count > 0) lines.push({ datPath: r.path, count: r.count })
      }
    }
    return lines
  }, [tabs])

  const persistLast = useCallback(
    async (lines: { datPath: string; count: number }[]): Promise<void> => {
      if (!compiledRoot) return
      await call(api.slideshow.writeLastList({ compiledRoot, lines }))
    },
    [compiledRoot]
  )

  const rebuildAndApply = useCallback(
    async (lines: { datPath: string; count: number }[], preferPath?: string | null): Promise<void> => {
      const { paths } = await call(api.slideshow.expandComposite({ lines }))
      await call(api.slideshow.applyCompiledPlaylist({ paths, preferPath: preferPath ?? null }))
      // Stay live so Clear (empty) and later +/- keep pushing into the running session.
      setPlaying(true)
    },
    []
  )

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const settings = await call(api.settings.get())
      const root = settings.slideshow.compiledFileListsFolder.trim()
      const ents = settings.slideshow.compiledListEntries ?? []
      setCompiledRoot(root)
      setEntries(ents)
      if (!root) {
        setTabs([])
        setStatus('Compiled file lists folder not set')
        return
      }
      const { tabs: raw } = await call(
        api.slideshow.listCompiledDats({ compiledRoot: root, entries: ents })
      )
      let next: TabData[] = raw.map((t) => ({
        name: t.name,
        rows: t.dats.map((d) => ({
          ...d,
          kind: d.kind,
          count: 0
        }))
      }))
      const { lines } = await call(api.slideshow.readLastList({ compiledRoot: root }))
      next = applyCounts(next, lines)
      setTabs(next)
      setActiveTab(0)
      setStatus('')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [applyCounts])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    document.documentElement.dataset.theme = 'dark'
  }, [])

  // Main window starts/resumes via broadcast — mark this window as live for instant +/- / Clear.
  useEffect(() => {
    return api.onEvent((event) => {
      if (event.type === 'compiled-playlist-apply') {
        setPlaying(true)
      }
    })
  }, [])

  const setRowCount = async (tabIdx: number, rowIdx: number, count: number): Promise<void> => {
    const c = Math.max(0, Math.floor(count))
    setTabs((prev) => {
      const next = prev.map((t, ti) => {
        if (ti !== tabIdx) return t
        return {
          ...t,
          rows: t.rows.map((r, ri) => (ri === rowIdx ? { ...r, count: c } : r))
        }
      })
      return next
    })
  }

  // Persist last.txt; when live, push playlist to the slideshow immediately.
  useEffect(() => {
    if (!compiledRoot || tabs.length === 0) return
    const lines = collectLines()
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          await persistLast(lines)
          if (playing) await rebuildAndApply(lines)
        } catch {
          /* ignore */
        }
      })()
    }, 150)
    return () => window.clearTimeout(t)
  }, [tabs, compiledRoot, persistLast, collectLines, playing, rebuildAndApply])

  const bump = async (tabIdx: number, rowIdx: number, delta: number): Promise<void> => {
    const row = tabs[tabIdx]?.rows[rowIdx]
    if (!row) return
    const nextCount = Math.max(0, row.count + delta)
    const nextTabs = tabs.map((t, ti) => {
      if (ti !== tabIdx) return t
      return {
        ...t,
        rows: t.rows.map((r, ri) => (ri === rowIdx ? { ...r, count: nextCount } : r))
      }
    })
    setTabs(nextTabs)
    const lines: { datPath: string; count: number }[] = []
    for (const t of nextTabs) {
      for (const r of t.rows) {
        if (r.count > 0) lines.push({ datPath: r.path, count: r.count })
      }
    }
    try {
      await persistLast(lines)
      if (playing) await rebuildAndApply(lines)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const loadComposite = async (): Promise<void> => {
    if (!listsDir) return
    setBusy(true)
    try {
      const { path: filePath } = await call(
        api.slideshow.pickOpenFile({
          title: 'Load composite list',
          defaultPath: listsDir,
          filters: [
            { name: 'Composite lists', extensions: ['txt'] },
            { name: 'All files', extensions: ['*'] }
          ]
        })
      )
      if (!filePath) return
      const { lines } = await call(api.slideshow.readCompositeList({ path: filePath }))
      setTabs((prev) => applyCounts(prev, lines))
      await persistLast(lines)
      setStatus('')
      if (playing) await rebuildAndApply(lines)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveComposite = async (): Promise<void> => {
    if (!listsDir) return
    setBusy(true)
    try {
      const lines = collectLines()
      const { path: filePath } = await call(
        api.slideshow.pickSaveFile({
          title: 'Save composite list',
          defaultPath: `${listsDir}\\list.txt`,
          filters: [{ name: 'Composite lists', extensions: ['txt'] }]
        })
      )
      if (!filePath) return
      await call(api.slideshow.writeCompositeList({ path: filePath, lines }))
      await persistLast(lines)
      setStatus('')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startPlaylist = async (): Promise<void> => {
    setBusy(true)
    try {
      const lines = collectLines()
      if (!lines.some((l) => l.count > 0)) {
        setStatus('Set at least one count > 0 (or Load a saved list)')
        return
      }
      await persistLast(lines)
      await rebuildAndApply(lines)
      setPlaying(true)
      setStatus('')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const clearCounts = async (): Promise<void> => {
    setBusy(true)
    try {
      const nextTabs = tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) => ({ ...r, count: 0 }))
      }))
      setTabs(nextTabs)
      await persistLast([])
      // Always push empty playlist when live; if not live yet but slideshow was
      // started from the main window, onEvent will have set playing.
      if (playing) await rebuildAndApply([])
      setStatus('')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const tab = tabs[activeTab]

  return (
    <div className="compiled-lists-app">
      <div className="compiled-lists-toolbar" role="toolbar" aria-label="Compiled lists">
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          aria-label="Load composite list"
          title="Load composite list"
          onClick={() => void loadComposite()}
        >
          <FolderOpenIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          aria-label="Save composite list"
          title="Save composite list"
          onClick={() => void saveComposite()}
        >
          <SaveIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          aria-label="Clear counts"
          title="Clear all counts"
          onClick={() => void clearCounts()}
        >
          <EraserIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          aria-label="Refresh lists"
          title="Refresh lists"
          onClick={() => void refresh()}
        >
          <RefreshIcon />
        </button>
        <span className="compiled-lists-toolbar-sep" aria-hidden />
        <button
          type="button"
          className="icon-btn"
          disabled={busy}
          aria-label={playing ? 'Apply to slideshow' : 'Start slideshow'}
          title={playing ? 'Apply to slideshow' : 'Start slideshow'}
          onClick={() => void startPlaylist()}
        >
          <PlayIcon />
        </button>
      </div>
      <div className="compiled-lists-tabs">
        {tabs.map((t, i) => (
          <button
            key={t.name}
            type="button"
            className={`compiled-lists-tab${i === activeTab ? ' active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {t.name}
          </button>
        ))}
        {tabs.length === 0 ? (
          <span className="dim">No category folders under the compiled lists root</span>
        ) : null}
      </div>
      <div className="compiled-lists-table-wrap">
        <table className="compiled-lists-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">#</th>
              <th></th>
              <th></th>
              <th className="num">Nb. Files</th>
            </tr>
          </thead>
          <tbody>
            {tab?.rows.map((r, ri) => (
              <tr key={r.path}>
                <td title={r.path}>{r.name}</td>
                <td className="num">
                  <input
                    className="compiled-count-input"
                    type="number"
                    min={0}
                    value={r.count}
                    disabled={busy}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (Number.isFinite(v)) void setRowCount(activeTab, ri, v)
                    }}
                    onBlur={() => {
                      const lines = collectLines()
                      void (async () => {
                        await persistLast(lines)
                        if (playing) await rebuildAndApply(lines)
                      })()
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy || r.count <= 0}
                    onClick={() => void bump(activeTab, ri, -1)}
                  >
                    −
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-tiny"
                    disabled={busy}
                    onClick={() => void bump(activeTab, ri, 1)}
                  >
                    +
                  </button>
                </td>
                <td className="num">{formatNb(r.fileCount)}</td>
              </tr>
            ))}
            {!tab || tab.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="dim">
                  No .dat / .txt list files in this folder
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="compiled-lists-footer dim">
        {status ? (
          status
        ) : (
          <>
            Auto-resume: {compiledRoot ? compiledLastTxtPath(compiledRoot) : '—'} · Load/Save under{' '}
            {listsDir || '!!Lists'}
          </>
        )}
      </p>
    </div>
  )
}
