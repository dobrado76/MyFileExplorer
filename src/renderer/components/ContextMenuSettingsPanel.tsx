import { useMemo, useRef, useState, type DragEvent, type JSX } from 'react'
import {
  MAX_CONTEXT_MENU_COMMANDS,
  newContextMenuCommandId,
  normalizeExtensions,
  type ContextMenuCommand
} from '@shared/contextMenuCommands'
import {
  CONTEXT_MENU_BUILTINS,
  DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT,
  newBuiltinLayoutSepId,
  sanitizeBuiltinLayout,
  syncDiscoveredInLayout,
  type ContextMenuBuiltinId,
  type ContextMenuBuiltinLayoutEntry
} from '@shared/contextMenuBuiltins'
import {
  MAX_DISCOVERED_ENABLED,
  mergeDiscoveredScan,
  type ContextMenuDiscoveredSettings,
  type DiscoveredShellVerb
} from '@shared/schemas/shellVerbs'
import { GripVertical } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'

type Scope = 'builtins' | 'discover' | 'files' | 'folders'
type CommandScope = 'files' | 'folders'
type DiscoverFilter = 'all' | 'files' | 'folders' | 'supported'

type Preset = {
  label: string
  scope: CommandScope
  executable: string
  argsTemplate: string
  match: ContextMenuCommand['match']
}

const PRESETS: Preset[] = [
  {
    label: 'Edit in Photoshop',
    scope: 'files',
    executable: '%ProgramFiles%\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe',
    argsTemplate: '{path}',
    match: {
      type: 'extensions',
      extensions: ['psd', 'psb', 'jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp']
    }
  },
  {
    label: 'Play in VLC',
    scope: 'files',
    executable: '%ProgramFiles%\\VideoLAN\\VLC\\vlc.exe',
    argsTemplate: '{paths}',
    match: {
      type: 'extensions',
      extensions: [
        'mp4',
        'mkv',
        'avi',
        'webm',
        'mov',
        'm4v',
        'wmv',
        'mp3',
        'flac',
        'wav',
        'aac',
        'ogg'
      ]
    }
  },
  {
    label: 'Play in VLC',
    scope: 'folders',
    executable: '%ProgramFiles%\\VideoLAN\\VLC\\vlc.exe',
    argsTemplate: '{path}',
    match: { type: 'all' }
  },
  {
    label: 'Open in VS Code',
    scope: 'files',
    executable: '%LocalAppData%\\Programs\\Microsoft VS Code\\Code.exe',
    argsTemplate: '{path}',
    match: { type: 'all' }
  },
  {
    label: 'Open in VS Code',
    scope: 'folders',
    executable: '%LocalAppData%\\Programs\\Microsoft VS Code\\Code.exe',
    argsTemplate: '{path}',
    match: { type: 'all' }
  },
  {
    label: 'Edit in Notepad++',
    scope: 'files',
    executable: '%ProgramFiles%\\Notepad++\\notepad++.exe',
    argsTemplate: '{path}',
    match: {
      type: 'extensions',
      extensions: [
        'txt',
        'md',
        'json',
        'xml',
        'html',
        'htm',
        'css',
        'js',
        'ts',
        'tsx',
        'jsx',
        'py',
        'cs',
        'cpp',
        'h',
        'ini',
        'cfg',
        'log'
      ]
    }
  }
]

function matchSummary(cmd: ContextMenuCommand, scope: CommandScope): string {
  if (scope === 'folders') return 'All folders'
  if (cmd.match.type === 'all') return 'All files'
  return cmd.match.extensions.map((e) => `.${e}`).join(', ') || '(no extensions)'
}

function emptyDraft(_scope: CommandScope): ContextMenuCommand {
  return {
    id: newContextMenuCommandId(),
    label: '',
    enabled: true,
    executable: '',
    argsTemplate: '{path}',
    match: { type: 'all' }
  }
}

export function ContextMenuSettingsPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const notify = useAppStore((s) => s.notify)

  const [scope, setScope] = useState<Scope>('builtins')
  const [editing, setEditing] = useState<ContextMenuCommand | null>(null)
  const [extText, setExtText] = useState('')
  const [discoverFilter, setDiscoverFilter] = useState<DiscoverFilter>('supported')
  const [discoverQuery, setDiscoverQuery] = useState('')
  const [discoverBusy, setDiscoverBusy] = useState(false)

  const list =
    scope === 'files'
      ? settings.contextMenu.files
      : scope === 'folders'
        ? settings.contextMenu.folders
        : []
  const hiddenBuiltins = useMemo(
    () => settings.contextMenu.hiddenBuiltins ?? [],
    [settings.contextMenu.hiddenBuiltins]
  )
  const hiddenSet = useMemo(() => new Set(hiddenBuiltins), [hiddenBuiltins])
  const discovered = useMemo(
    () => settings.contextMenu.discovered ?? { verbs: [], scannedKeys: 0, enabledIds: [] },
    [settings.contextMenu.discovered]
  )
  const discoverEnabled = useMemo(
    () => new Set(discovered.enabledIds),
    [discovered.enabledIds]
  )
  const discoveredById = useMemo(() => {
    const m = new Map<string, DiscoveredShellVerb>()
    for (const v of discovered.verbs) m.set(v.id, v)
    return m
  }, [discovered.verbs])
  const builtinLayout = useMemo(() => {
    const base = sanitizeBuiltinLayout(
      settings.contextMenu.builtinLayout ?? DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT
    )
    return syncDiscoveredInLayout(base, discovered.enabledIds)
  }, [settings.contextMenu.builtinLayout, discovered.enabledIds])
  const builtinById = useMemo(() => {
    const m = new Map(CONTEXT_MENU_BUILTINS.map((b) => [b.id, b]))
    return m
  }, [])
  const dragLayoutIndex = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const presetsForScope = useMemo(
    () => (scope === 'files' || scope === 'folders' ? PRESETS.filter((p) => p.scope === scope) : []),
    [scope]
  )

  const persistContextMenu = (partial: {
    files?: typeof settings.contextMenu.files
    folders?: typeof settings.contextMenu.folders
    hiddenBuiltins?: ContextMenuBuiltinId[]
    builtinLayout?: ContextMenuBuiltinLayoutEntry[]
    discovered?: ContextMenuDiscoveredSettings
  }): void => {
    void applySettingsPatch({
      contextMenu: {
        files: partial.files ?? settings.contextMenu.files,
        folders: partial.folders ?? settings.contextMenu.folders,
        hiddenBuiltins: partial.hiddenBuiltins ?? settings.contextMenu.hiddenBuiltins,
        builtinLayout: partial.builtinLayout ?? settings.contextMenu.builtinLayout,
        discovered: partial.discovered ?? settings.contextMenu.discovered
      }
    })
  }

  const persistCommands = (next: ContextMenuCommand[]): void => {
    if (scope !== 'files' && scope !== 'folders') return
    persistContextMenu({
      files: scope === 'files' ? next : settings.contextMenu.files,
      folders: scope === 'folders' ? next : settings.contextMenu.folders
    })
  }

  const persistHiddenBuiltins = (next: string[]): void => {
    persistContextMenu({ hiddenBuiltins: next as ContextMenuBuiltinId[] })
  }

  const persistBuiltinLayout = (next: ContextMenuBuiltinLayoutEntry[]): void => {
    persistContextMenu({
      builtinLayout: syncDiscoveredInLayout(
        sanitizeBuiltinLayout(next),
        discovered.enabledIds
      )
    })
  }

  const setBuiltinEnabled = (id: ContextMenuBuiltinId, enabled: boolean): void => {
    const next = enabled
      ? hiddenBuiltins.filter((h) => h !== id)
      : hiddenSet.has(id)
        ? [...hiddenBuiltins]
        : [...hiddenBuiltins, id]
    persistHiddenBuiltins(next)
  }

  const showAllBuiltins = (): void => persistHiddenBuiltins([])
  const hideAllBuiltins = (): void =>
    persistHiddenBuiltins(CONTEXT_MENU_BUILTINS.map((b) => b.id))

  const resetBuiltinLayout = (): void => {
    persistBuiltinLayout(
      syncDiscoveredInLayout(DEFAULT_CONTEXT_MENU_BUILTIN_LAYOUT, discovered.enabledIds)
    )
  }

  const addBuiltinSeparator = (): void => {
    persistBuiltinLayout([...builtinLayout, { type: 'sep', id: newBuiltinLayoutSepId() }])
  }

  const removeBuiltinSeparator = (sepId: string): void => {
    persistBuiltinLayout(builtinLayout.filter((e) => !(e.type === 'sep' && e.id === sepId)))
  }

  const reorderBuiltinLayout = (from: number, to: number): void => {
    if (from === to || from < 0 || to < 0 || from >= builtinLayout.length || to >= builtinLayout.length)
      return
    const next = [...builtinLayout]
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    persistBuiltinLayout(next)
  }

  const setDiscoveredEnabled = (id: string, enabled: boolean): void => {
    const verb = discoveredById.get(id)
    if (!verb?.supported) return
    let enabledIds = [...discovered.enabledIds]
    if (enabled) {
      if (enabledIds.includes(id)) return
      if (enabledIds.length >= MAX_DISCOVERED_ENABLED) {
        notify(`Maximum ${MAX_DISCOVERED_ENABLED} enabled Discover verbs`, true)
        return
      }
      enabledIds.push(id)
    } else {
      enabledIds = enabledIds.filter((x) => x !== id)
    }
    const nextDiscovered = { ...discovered, enabledIds }
    const nextLayout = syncDiscoveredInLayout(builtinLayout, enabledIds)
    persistContextMenu({ discovered: nextDiscovered, builtinLayout: nextLayout })
  }

  const openEdit = (cmd: ContextMenuCommand): void => {
    setEditing({ ...cmd, match: { ...cmd.match } })
    setExtText(cmd.match.type === 'extensions' ? cmd.match.extensions.join(', ') : '')
  }

  const openAdd = (): void => {
    if (scope !== 'files' && scope !== 'folders') return
    if (list.length >= MAX_CONTEXT_MENU_COMMANDS) {
      notify(`Maximum ${MAX_CONTEXT_MENU_COMMANDS} commands per list`, true)
      return
    }
    openEdit(emptyDraft(scope))
  }

  const addPreset = (preset: Preset): void => {
    if (scope !== 'files' && scope !== 'folders') return
    if (list.length >= MAX_CONTEXT_MENU_COMMANDS) {
      notify(`Maximum ${MAX_CONTEXT_MENU_COMMANDS} commands per list`, true)
      return
    }
    const cmd: ContextMenuCommand = {
      id: newContextMenuCommandId(),
      label: preset.label,
      enabled: true,
      executable: preset.executable,
      argsTemplate: preset.argsTemplate,
      match:
        preset.match.type === 'extensions'
          ? { type: 'extensions', extensions: [...preset.match.extensions] }
          : { type: 'all' }
    }
    openEdit(cmd)
  }

  const saveEdit = (): void => {
    if (!editing || (scope !== 'files' && scope !== 'folders')) return
    const label = editing.label.trim()
    const executable = editing.executable.trim()
    if (!label || !executable) {
      notify('Label and program path are required', true)
      return
    }
    let match: ContextMenuCommand['match'] = { type: 'all' }
    if (scope === 'files' && editing.match.type === 'extensions') {
      const extensions = normalizeExtensions(extText)
      if (extensions.length === 0) {
        notify('Enter at least one extension, or choose All files', true)
        return
      }
      match = { type: 'extensions', extensions }
    }
    const cmd: ContextMenuCommand = {
      ...editing,
      label,
      executable,
      argsTemplate: editing.argsTemplate.trim() || '{path}',
      match: scope === 'folders' ? { type: 'all' } : match
    }
    const idx = list.findIndex((c) => c.id === cmd.id)
    const next = idx >= 0 ? list.map((c, i) => (i === idx ? cmd : c)) : [...list, cmd]
    if (next.length > MAX_CONTEXT_MENU_COMMANDS) {
      notify(`Maximum ${MAX_CONTEXT_MENU_COMMANDS} commands per list`, true)
      return
    }
    persistCommands(next)
    setEditing(null)
  }

  const toggleEnabled = (id: string, enabled: boolean): void => {
    persistCommands(list.map((c) => (c.id === id ? { ...c, enabled } : c)))
  }

  const remove = (id: string): void => {
    persistCommands(list.filter((c) => c.id !== id))
  }

  const move = (id: string, dir: -1 | 1): void => {
    const idx = list.findIndex((c) => c.id === id)
    if (idx < 0) return
    const j = idx + dir
    if (j < 0 || j >= list.length) return
    const next = [...list]
    const tmp = next[idx]!
    next[idx] = next[j]!
    next[j] = tmp
    persistCommands(next)
  }

  const browseExe = async (): Promise<void> => {
    if (!editing) return
    const res = await call(
      api.slideshow.pickOpenFile({
        title: 'Select program',
        filters: [
          { name: 'Programs', extensions: ['exe', 'cmd', 'bat'] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
    )
    if (res.path) setEditing({ ...editing, executable: res.path })
  }

  const insertToken = (token: string): void => {
    if (!editing) return
    const cur = editing.argsTemplate
    const next = cur.trim() ? `${cur.trim()} ${token}` : token
    setEditing({ ...editing, argsTemplate: next })
  }

  const filteredDiscover = useMemo(() => {
    const q = discoverQuery.trim().toLowerCase()
    return discovered.verbs.filter((v) => {
      if (discoverFilter === 'supported' && !v.supported) return false
      if (discoverFilter === 'files' && v.targetKind === 'folders') return false
      if (discoverFilter === 'folders' && v.targetKind === 'files') return false
      if (!q) return true
      return (
        v.label.toLowerCase().includes(q) ||
        v.targetHint.toLowerCase().includes(q) ||
        v.commandPreview.toLowerCase().includes(q) ||
        (v.executable ?? '').toLowerCase().includes(q)
      )
    })
  }, [discovered.verbs, discoverFilter, discoverQuery])

  const runDiscoverScan = async (): Promise<void> => {
    setDiscoverBusy(true)
    try {
      const res = await call(api.shell.discoverVerbs())
      if (res.platform !== 'win32') {
        notify('Shell verb discovery is only available on Windows', true)
      }
      const nextDiscovered = mergeDiscoveredScan(discovered, {
        verbs: res.verbs,
        scannedKeys: res.scannedKeys
      })
      const nextLayout = syncDiscoveredInLayout(builtinLayout, nextDiscovered.enabledIds)
      persistContextMenu({ discovered: nextDiscovered, builtinLayout: nextLayout })
      if (res.verbs.length === 0) {
        notify('No shell verbs found', true)
      } else {
        notify(
          `Found ${res.verbs.length} shell verb${res.verbs.length === 1 ? '' : 's'} · ${nextDiscovered.enabledIds.length} still enabled`
        )
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Discover scan failed', true)
    } finally {
      setDiscoverBusy(false)
    }
  }

  return (
    <div className="settings-grid context-menu-settings">
      <p className="settings-help">
        Turn built-in menu items on or off, drag to set order and separators. Use Discover to scan
        static Windows shell verbs — tick to enable (they appear under Built-in for ordering; no COM
        shell extensions). Custom (files/folders) are hand-edited external programs. All of this is
        included in Settings → Advanced → Export / Import.
      </p>

      <div className="context-menu-scope-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={scope === 'builtins' ? 'active' : ''}
          aria-selected={scope === 'builtins'}
          title="Show or hide MyFileExplorer’s built-in right-click commands (Open, Copy, Delete, …)"
          onClick={() => {
            setScope('builtins')
            setEditing(null)
          }}
        >
          Built-in
        </button>
        <button
          type="button"
          role="tab"
          className={scope === 'discover' ? 'active' : ''}
          aria-selected={scope === 'discover'}
          title="Scan static Windows shell verbs; tick to enable them on the menu (order under Built-in)"
          onClick={() => {
            setScope('discover')
            setEditing(null)
          }}
        >
          Discover
        </button>
        <button
          type="button"
          role="tab"
          className={scope === 'files' ? 'active' : ''}
          aria-selected={scope === 'files'}
          title="Your custom programs that appear when files are selected (e.g. Edit in Photoshop)"
          onClick={() => {
            setScope('files')
            setEditing(null)
          }}
        >
          Custom (files)
        </button>
        <button
          type="button"
          role="tab"
          className={scope === 'folders' ? 'active' : ''}
          aria-selected={scope === 'folders'}
          title="Your custom programs that appear when folders are selected (e.g. Open in VS Code)"
          onClick={() => {
            setScope('folders')
            setEditing(null)
          }}
        >
          Custom (folders)
        </button>
      </div>

      {scope === 'builtins' ? (
        <>
          <div className="context-menu-toolbar">
            <button
              type="button"
              className="btn"
              title="Enable every built-in context-menu item"
              onClick={showAllBuiltins}
            >
              Show all
            </button>
            <button
              type="button"
              className="btn"
              title="Hide every built-in context-menu item (custom commands are unchanged)"
              onClick={hideAllBuiltins}
            >
              Hide all
            </button>
            <button
              type="button"
              className="btn"
              title="Insert a horizontal separator at the end of the list (drag it into place)"
              onClick={addBuiltinSeparator}
            >
              Add separator
            </button>
            <button
              type="button"
              className="btn"
              title="Restore the default built-in order and grouping"
              onClick={resetBuiltinLayout}
            >
              Reset order
            </button>
            <span className="context-menu-count">
              {CONTEXT_MENU_BUILTINS.length - hiddenSet.size} / {CONTEXT_MENU_BUILTINS.length}{' '}
              shown
            </span>
          </div>
          <div className="context-menu-builtin-list" role="list">
            {builtinLayout.map((entry, index) => {
              const onRowDragStart = (e: DragEvent): void => {
                const t = e.target as HTMLElement
                if (t.closest('input, button, a, label')) {
                  e.preventDefault()
                  return
                }
                dragLayoutIndex.current = index
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(index))
              }
              const onRowDragEnd = (): void => {
                dragLayoutIndex.current = null
                setDragOverIndex(null)
              }
              const onRowDragOver = (e: DragEvent): void => {
                e.preventDefault()
                setDragOverIndex(index)
              }
              const onRowDragLeave = (): void => {
                setDragOverIndex((cur) => (cur === index ? null : cur))
              }
              const onRowDrop = (e: DragEvent): void => {
                e.preventDefault()
                const from = dragLayoutIndex.current
                dragLayoutIndex.current = null
                setDragOverIndex(null)
                if (from != null) reorderBuiltinLayout(from, index)
              }

              if (entry.type === 'sep') {
                return (
                  <div
                    key={entry.id}
                    className={`context-menu-builtin-sep${dragOverIndex === index ? ' drag-over' : ''}`}
                    role="listitem"
                    title="Separator — drag to regroup the menu"
                    draggable
                    onDragStart={onRowDragStart}
                    onDragEnd={onRowDragEnd}
                    onDragOver={onRowDragOver}
                    onDragLeave={onRowDragLeave}
                    onDrop={onRowDrop}
                  >
                    <span className="context-menu-builtin-grip" aria-hidden>
                      <GripVertical size={14} />
                    </span>
                    <span className="context-menu-builtin-sep-line" aria-hidden />
                    <button
                      type="button"
                      className="btn context-menu-builtin-sep-remove"
                      title="Remove this separator"
                      onClick={() => removeBuiltinSeparator(entry.id)}
                    >
                      Remove
                    </button>
                  </div>
                )
              }
              if (entry.type === 'discovered') {
                const v = discoveredById.get(entry.id)
                const label = v?.label ?? entry.id
                const hint = v
                  ? `${v.targetHint}${v.executable ? ` · ${v.executable}` : ''}`
                  : 'Enable under Discover'
                return (
                  <div
                    key={`disc-${entry.id}`}
                    className={`context-menu-builtin-row is-discovered${
                      dragOverIndex === index ? ' drag-over' : ''
                    }`}
                    role="listitem"
                    title={`${label} — enabled under Discover (untick there to remove)`}
                    draggable
                    onDragStart={onRowDragStart}
                    onDragEnd={onRowDragEnd}
                    onDragOver={onRowDragOver}
                    onDragLeave={onRowDragLeave}
                    onDrop={onRowDrop}
                  >
                    <span className="context-menu-builtin-grip" aria-hidden>
                      <GripVertical size={14} />
                    </span>
                    <span className="context-menu-cmd-label">
                      {label}
                      <span className="context-menu-builtin-discovered-mark">discover</span>
                    </span>
                    <span className="context-menu-builtin-hint">{hint}</span>
                  </div>
                )
              }
              const b = builtinById.get(entry.id)
              if (!b) return null
              const enabled = !hiddenSet.has(b.id)
              return (
                <div
                  key={b.id}
                  className={`context-menu-builtin-row${enabled ? '' : ' is-disabled'}${
                    dragOverIndex === index ? ' drag-over' : ''
                  }`}
                  role="listitem"
                  title={b.hint ? `${b.label} — ${b.hint}` : b.label}
                  draggable
                  onDragStart={onRowDragStart}
                  onDragEnd={onRowDragEnd}
                  onDragOver={onRowDragOver}
                  onDragLeave={onRowDragLeave}
                  onDrop={onRowDrop}
                >
                  <span className="context-menu-builtin-grip" aria-hidden>
                    <GripVertical size={14} />
                  </span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    aria-label={b.label}
                    onChange={(e) => setBuiltinEnabled(b.id, e.target.checked)}
                  />
                  <span className="context-menu-cmd-label">{b.label}</span>
                  <span className="context-menu-builtin-hint">{b.hint ?? ''}</span>
                </div>
              )
            })}
          </div>
        </>
      ) : scope === 'discover' ? (
        <>
          <div className="context-menu-toolbar">
            <button
              type="button"
              className="btn primary"
              disabled={discoverBusy}
              title="Refresh the cached registry scan. Enabled ticks are kept when verbs still exist"
              onClick={() => void runDiscoverScan()}
            >
              {discoverBusy ? 'Scanning…' : discovered.verbs.length > 0 ? 'Rescan' : 'Scan now'}
            </button>
            <label
              className="context-menu-preset"
              title="Filter the scan results list"
            >
              Show
              <select
                value={discoverFilter}
                aria-label="Filter discovered verbs"
                title="Supported = can be enabled on the menu; All includes unsupported COM/opaque entries"
                onChange={(e) => setDiscoverFilter(e.target.value as DiscoverFilter)}
              >
                <option value="supported">Supported</option>
                <option value="all">All</option>
                <option value="files">Files</option>
                <option value="folders">Folders</option>
              </select>
            </label>
            <input
              type="search"
              className="context-menu-discover-search"
              placeholder="Search…"
              value={discoverQuery}
              onChange={(e) => setDiscoverQuery(e.target.value)}
              aria-label="Search discovered verbs"
              title="Filter by label, target, or program path"
            />
            <span className="context-menu-count">
              {discovered.enabledIds.length} / {MAX_DISCOVERED_ENABLED} enabled
              {discovered.verbs.length > 0
                ? ` · ${filteredDiscover.length}/${discovered.verbs.length}`
                : ''}
              {discovered.scannedKeys > 0 ? ` · ${discovered.scannedKeys} roots` : ''}
            </span>
          </div>
          <p className="settings-help" style={{ margin: 0 }}>
            Tick a supported verb to show it on the context menu. Order it under Built-in (tinted
            rows, no checkbox). The scan list is saved — Rescan refreshes without clearing your
            ticks.
          </p>
          <div className="context-menu-discover-list" role="list">
            {discovered.verbs.length === 0 && !discoverBusy ? (
              <div className="context-menu-empty">
                Click Scan now to read static Windows shell verbs from the registry. COM shell
                extensions are not loaded. Results are remembered until you rescan.
              </div>
            ) : null}
            {filteredDiscover.map((v) => {
              const checked = discoverEnabled.has(v.id)
              return (
                <label
                  key={v.id}
                  className={`context-menu-discover-row${v.supported ? '' : ' is-disabled'}`}
                  role="listitem"
                  title={
                    v.supported
                      ? `${v.label}\n${v.targetHint}${v.executable ? `\n${v.executable}` : ''}\n${v.commandPreview}`
                      : `${v.label} — ${v.unsupportedReason ?? 'Cannot enable'}`
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!v.supported}
                    onChange={(e) => setDiscoveredEnabled(v.id, e.target.checked)}
                  />
                  <span className="context-menu-builtin-text">
                    <span className="context-menu-cmd-label">
                      {v.label}
                      {v.advanced ? (
                        <span className="context-menu-discover-badge">advanced</span>
                      ) : null}
                      {!v.supported ? (
                        <span className="context-menu-discover-badge warn">unsupported</span>
                      ) : null}
                    </span>
                    <span className="context-menu-builtin-hint">
                      {v.targetHint}
                      {v.executable ? ` · ${v.executable}` : ''}
                      {v.unsupportedReason ? ` — ${v.unsupportedReason}` : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="context-menu-toolbar">
            <button
              type="button"
              className="btn"
              onClick={openAdd}
              disabled={!!editing}
              title={
                scope === 'files'
                  ? 'Create a new custom command for selected files'
                  : 'Create a new custom command for selected folders'
              }
            >
              Add
            </button>
            <label
              className="context-menu-preset"
              title="Start from a common preset (Photoshop, VLC, VS Code, …), then edit paths if needed"
            >
              Add common…
              <select
                value=""
                disabled={!!editing}
                aria-label="Add common command"
                title="Insert a preset command into the editor"
                onChange={(e) => {
                  const i = Number(e.target.value)
                  if (!Number.isFinite(i) || !presetsForScope[i]) return
                  addPreset(presetsForScope[i]!)
                  e.target.value = ''
                }}
              >
                <option value="">Choose…</option>
                {presetsForScope.map((p, i) => (
                  <option key={`${p.label}-${i}`} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="context-menu-count">
              {list.length} / {MAX_CONTEXT_MENU_COMMANDS}
            </span>
          </div>

          <div className="context-menu-cmd-list" role="list">
            {list.length === 0 && (
              <div className="context-menu-empty">No custom commands yet.</div>
            )}
            {list.map((cmd, i) => (
              <div key={cmd.id} className="context-menu-cmd-row" role="listitem">
                <label
                  className="context-menu-cmd-enable"
                  title={cmd.enabled ? 'Shown in the context menu' : 'Hidden until enabled'}
                >
                  <input
                    type="checkbox"
                    checked={cmd.enabled}
                    onChange={(e) => toggleEnabled(cmd.id, e.target.checked)}
                  />
                </label>
                <div className="context-menu-cmd-main">
                  <div className="context-menu-cmd-label">{cmd.label}</div>
                  <div className="context-menu-cmd-meta">
                    <span>{matchSummary(cmd, scope)}</span>
                    <span title={cmd.executable}>{cmd.executable}</span>
                  </div>
                </div>
                <div className="context-menu-cmd-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={i === 0}
                    title="Move up in the menu order"
                    onClick={() => move(cmd.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={i === list.length - 1}
                    title="Move down in the menu order"
                    onClick={() => move(cmd.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn"
                    title="Edit label, program path, arguments, and match rules"
                    onClick={() => openEdit(cmd)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    title="Remove this custom command"
                    onClick={() => remove(cmd.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {editing && (
            <div className="context-menu-edit">
              <h3 className="settings-subheading">
                {list.some((c) => c.id === editing.id) ? 'Edit command' : 'New command'}
              </h3>
              <label className="settings-field context-menu-edit-field">
                <span>Label</span>
                <input
                  type="text"
                  value={editing.label}
                  maxLength={80}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="Edit in Photoshop"
                  title="Text shown in the right-click menu"
                  autoFocus
                />
              </label>
              <label className="settings-field context-menu-edit-field">
                <span>Program</span>
                <div className="settings-inline">
                  <input
                    type="text"
                    value={editing.executable}
                    onChange={(e) => setEditing({ ...editing, executable: e.target.value })}
                    placeholder="%ProgramFiles%\…\app.exe"
                    spellCheck={false}
                    title="Absolute path to the .exe (environment variables like %ProgramFiles% are OK)"
                  />
                  <button
                    type="button"
                    className="btn"
                    title="Browse for an executable on disk"
                    onClick={() => void browseExe()}
                  >
                    Browse…
                  </button>
                </div>
              </label>
              <label className="settings-field context-menu-edit-field">
                <span>Arguments</span>
                <input
                  type="text"
                  value={editing.argsTemplate}
                  onChange={(e) => setEditing({ ...editing, argsTemplate: e.target.value })}
                  placeholder="{path}"
                  spellCheck={false}
                  title="Command-line arguments. Prefer {path}; %1 also works. .bat/.cmd are supported"
                />
              </label>
              <div className="context-menu-tokens">
                {(
                  [
                    ['{path}', 'Full path of the first selected item'],
                    ['{paths}', 'One argument per selected path'],
                    ['{dir}', 'Parent folder of the first selected item'],
                    ['{name}', 'File or folder name only']
                  ] as const
                ).map(([t, tip]) => (
                  <button
                    key={t}
                    type="button"
                    className="btn"
                    title={tip}
                    onClick={() => insertToken(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="context-menu-edit-footer">
                {scope === 'files' && (
                  <fieldset className="context-menu-match">
                    <legend>Show for</legend>
                    <label
                      className="power-rename-check"
                      title="Show this command for any selected files"
                    >
                      <input
                        type="radio"
                        name="cmc-match"
                        checked={editing.match.type === 'all'}
                        onChange={() => setEditing({ ...editing, match: { type: 'all' } })}
                      />
                      All files
                    </label>
                    <label
                      className="power-rename-check"
                      title="Only show when every selected file matches these extensions"
                    >
                      <input
                        type="radio"
                        name="cmc-match"
                        checked={editing.match.type === 'extensions'}
                        onChange={() =>
                          setEditing({
                            ...editing,
                            match: { type: 'extensions', extensions: normalizeExtensions(extText) }
                          })
                        }
                      />
                      These extensions
                    </label>
                    {editing.match.type === 'extensions' && (
                      <input
                        type="text"
                        value={extText}
                        onChange={(e) => setExtText(e.target.value)}
                        placeholder="jpg, png, psd"
                        spellCheck={false}
                        title="Comma-separated extensions without dots"
                      />
                    )}
                  </fieldset>
                )}
                <div className="context-menu-edit-actions">
                  <button
                    type="button"
                    className="btn"
                    title="Discard changes and close the editor"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    title="Save this command to the custom list"
                    onClick={saveEdit}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
