import { useMemo, useState, type JSX } from 'react'
import {
  MAX_CONTEXT_MENU_COMMANDS,
  newContextMenuCommandId,
  normalizeExtensions,
  type ContextMenuCommand
} from '@shared/contextMenuCommands'
import {
  CONTEXT_MENU_BUILTINS,
  type ContextMenuBuiltinId
} from '@shared/contextMenuBuiltins'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'

type Scope = 'builtins' | 'files' | 'folders'
type CommandScope = 'files' | 'folders'

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

  const presetsForScope = useMemo(
    () => (scope === 'files' || scope === 'folders' ? PRESETS.filter((p) => p.scope === scope) : []),
    [scope]
  )

  const persistCommands = (next: ContextMenuCommand[]): void => {
    if (scope !== 'files' && scope !== 'folders') return
    void applySettingsPatch({
      contextMenu: {
        files: scope === 'files' ? next : settings.contextMenu.files,
        folders: scope === 'folders' ? next : settings.contextMenu.folders,
        hiddenBuiltins: settings.contextMenu.hiddenBuiltins
      }
    })
  }

  const persistHiddenBuiltins = (next: string[]): void => {
    void applySettingsPatch({
      contextMenu: {
        files: settings.contextMenu.files,
        folders: settings.contextMenu.folders,
        hiddenBuiltins: next as ContextMenuBuiltinId[]
      }
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

  return (
    <div className="settings-grid context-menu-settings">
      <p className="settings-help">
        Turn built-in menu items on or off, and add external programs (e.g. Edit in Photoshop, Play
        in VLC). Custom commands appear when the selection matches.
      </p>

      <div className="context-menu-scope-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={scope === 'builtins' ? 'active' : ''}
          aria-selected={scope === 'builtins'}
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
          className={scope === 'files' ? 'active' : ''}
          aria-selected={scope === 'files'}
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
            <button type="button" className="btn" onClick={showAllBuiltins}>
              Show all
            </button>
            <button type="button" className="btn" onClick={hideAllBuiltins}>
              Hide all
            </button>
            <span className="context-menu-count">
              {CONTEXT_MENU_BUILTINS.length - hiddenSet.size} / {CONTEXT_MENU_BUILTINS.length}{' '}
              shown
            </span>
          </div>
          <div className="context-menu-builtin-list" role="list">
            {CONTEXT_MENU_BUILTINS.map((b) => {
              const enabled = !hiddenSet.has(b.id)
              return (
                <label key={b.id} className="context-menu-builtin-row" role="listitem">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setBuiltinEnabled(b.id, e.target.checked)}
                  />
                  <span className="context-menu-builtin-text">
                    <span className="context-menu-cmd-label">{b.label}</span>
                    {b.hint ? <span className="context-menu-builtin-hint">{b.hint}</span> : null}
                  </span>
                </label>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="context-menu-toolbar">
            <button type="button" className="btn" onClick={openAdd} disabled={!!editing}>
              Add
            </button>
            <label className="context-menu-preset">
              Add common…
              <select
                value=""
                disabled={!!editing}
                aria-label="Add common command"
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
                <label className="context-menu-cmd-enable" title="Enabled">
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
                    onClick={() => move(cmd.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={i === list.length - 1}
                    onClick={() => move(cmd.id, 1)}
                  >
                    ↓
                  </button>
                  <button type="button" className="btn" onClick={() => openEdit(cmd)}>
                    Edit
                  </button>
                  <button type="button" className="btn danger" onClick={() => remove(cmd.id)}>
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
              <label className="settings-field">
                <span>Label</span>
                <input
                  type="text"
                  value={editing.label}
                  maxLength={80}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="Edit in Photoshop"
                  autoFocus
                />
              </label>
              <label className="settings-field">
                <span>Program</span>
                <div className="settings-inline">
                  <input
                    type="text"
                    value={editing.executable}
                    onChange={(e) => setEditing({ ...editing, executable: e.target.value })}
                    placeholder="%ProgramFiles%\…\app.exe"
                    spellCheck={false}
                  />
                  <button type="button" className="btn" onClick={() => void browseExe()}>
                    Browse…
                  </button>
                </div>
              </label>
              <label className="settings-field">
                <span>Arguments</span>
                <input
                  type="text"
                  value={editing.argsTemplate}
                  onChange={(e) => setEditing({ ...editing, argsTemplate: e.target.value })}
                  placeholder="{path}"
                  spellCheck={false}
                />
              </label>
              <div className="context-menu-tokens">
                {(['{path}', '{paths}', '{dir}', '{name}'] as const).map((t) => (
                  <button key={t} type="button" className="btn" onClick={() => insertToken(t)}>
                    {t}
                  </button>
                ))}
              </div>
              {scope === 'files' && (
                <fieldset className="context-menu-match">
                  <legend>Show for</legend>
                  <label className="power-rename-check">
                    <input
                      type="radio"
                      name="cmc-match"
                      checked={editing.match.type === 'all'}
                      onChange={() => setEditing({ ...editing, match: { type: 'all' } })}
                    />
                    All files
                  </label>
                  <label className="power-rename-check">
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
                    />
                  )}
                </fieldset>
              )}
              <label className="power-rename-check">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <div className="context-menu-edit-actions">
                <button type="button" className="btn" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button type="button" className="btn primary" onClick={saveEdit}>
                  Save
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
