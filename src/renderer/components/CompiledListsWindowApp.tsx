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
import { useIdleCursorHide } from '../lib/useIdleCursorHide'
import { isSlideshowCropNumpadKey, isSlideshowStopKey } from '@shared/slideshow/keys'

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
  const [tabs, setTabs] = useState<TabData[]>([])
  const [activeTab, setActiveTab] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

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
    async (
      lines: { datPath: string; count: number }[],
      preferPath?: string | null,
      opts?: { resumePlaying?: boolean }
    ): Promise<void> => {
      const settings = await call(api.settings.get())
      const snap = await call(
        api.slideshow.applyCompiledLines({
          lines,
          order: settings.slideshow.order,
          ascending: settings.slideshow.ascending,
          preferPath: preferPath ?? null,
          resumePlaying: opts?.resumePlaying === true
        })
      )
      if (snap.listCounts && snap.listCounts.length > 0) {
        const map = new Map(snap.listCounts.map((c) => [c.path.toLowerCase(), c.fileCount]))
        setTabs((prev) =>
          prev.map((t) => ({
            ...t,
            rows: t.rows.map((r) => {
              const n = map.get(r.path.toLowerCase())
              return n === undefined || n === r.fileCount ? r : { ...r, fileCount: n }
            })
          }))
        )
      }
      if (lines.some((l) => l.count > 0) && snap.total === 0) {
        setStatus('No images resolved — check .dat Index / nested .txt refs (or run Update Lists on .dat)')
      } else if (snap.truncated) {
        setStatus(`Playlist truncated at 2,147,483,647 entries (${snap.total.toLocaleString()} kept)`)
      } else if (snap.total > 0) {
        setStatus('')
      }
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

  // This window only exists during a compiled slideshow — hide idle cursor here too
  // (focus often stays on lists while watching the main overlay).
  useIdleCursorHide(true)

  // Relay keys / wheel / clicks to the main slideshow (overlay cannot take click-focus).
  useEffect(() => {
    const isEditableTarget = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false
      if (t.isContentEditable) return true
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      return Boolean(t.closest('input, textarea, select, [contenteditable="true"]'))
    }

    const isListsChrome = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false
      if (isEditableTarget(t)) return true
      return Boolean(
        t.closest(
          'button, a, input, textarea, select, label, [role="tab"], .compiled-lists-tab, .compiled-count-input'
        )
      )
    }

    const onKey = (e: KeyboardEvent): void => {
      const stopKey = isSlideshowStopKey({
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
      })
      if (!stopKey && isEditableTarget(e.target)) return
      const cropNumpad = isSlideshowCropNumpadKey(e)
      if ((e.ctrlKey || e.metaKey || e.altKey) && !cropNumpad) return
      e.preventDefault()
      e.stopPropagation()
      void api.slideshow.relayKey({
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey
      })
    }

    const onWheel = (e: WheelEvent): void => {
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      void api.slideshow.relayPointer({
        kind: 'wheel',
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey
      })
    }

    const onClick = (e: MouseEvent): void => {
      if (e.button !== 0) return
      if (isListsChrome(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      void api.slideshow.relayPointer({ kind: 'click' })
    }

    const onContextMenu = (e: MouseEvent): void => {
      if (isListsChrome(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      void api.slideshow.relayPointer({ kind: 'contextmenu' })
    }

    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('click', onClick, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
    }
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

  // Persist last.txt and always push playlist (window exists only for a live compiled session).
  useEffect(() => {
    if (!compiledRoot || tabs.length === 0) return
    let applyGen = 0
    const lines = collectLines()
    const t = window.setTimeout(() => {
      const gen = ++applyGen
      void (async () => {
        try {
          await persistLast(lines)
          if (gen !== applyGen) return
          await rebuildAndApply(lines)
        } catch {
          /* ignore */
        }
      })()
    }, 200)
    return () => {
      window.clearTimeout(t)
      applyGen += 1
    }
  }, [tabs, compiledRoot, persistLast, collectLines, rebuildAndApply])

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
    // Debounced effect persists + applies; also push immediately for snappy +/-.
    const lines: { datPath: string; count: number }[] = []
    for (const t of nextTabs) {
      for (const r of t.rows) {
        if (r.count > 0) lines.push({ datPath: r.path, count: r.count })
      }
    }
    try {
      await persistLast(lines)
      await rebuildAndApply(lines)
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
      await rebuildAndApply(lines)
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
      await persistLast(lines)
      // Play always resumes autoplay (manual → playing), even if the playlist is unchanged.
      await rebuildAndApply(lines, null, { resumePlaying: true })
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
      await rebuildAndApply([])
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
          aria-label="Resume slideshow"
          title="Resume slideshow (autoplay)"
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
                        await rebuildAndApply(lines)
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
