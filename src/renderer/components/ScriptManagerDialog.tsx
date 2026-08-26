import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { ScriptDefinition, ScriptLanguage, ScriptScope, ScriptToolbarShow } from '@shared/schemas/scripts'
import {
  defaultScriptDefinition,
  isGlobalScript,
  scriptFileExtension,
  SCRIPT_TOOLBAR_LUCIDE_COLOR,
  SCRIPT_TOOLBAR_LUCIDE_DEFAULT
} from '@shared/schemas/scripts'
import type { QuickLaunchItem } from '@shared/schemas/quickLaunch'
import {
  QUICK_LAUNCH_ICON_SIZE_DEFAULT,
  QUICK_LAUNCH_ICON_SIZE_MAX,
  QUICK_LAUNCH_ICON_SIZE_MIN
} from '@shared/schemas/quickLaunch'
import { looksDestructive } from '@shared/scriptDestructive'
import { useAppStore } from '../store/appStore'
import {
  CopyInstall,
  DestructiveBanner,
  RiskBanner,
  ScriptModal,
  SourceEditor,
  api,
  call,
  formatError
} from './scriptUi'
import { GlobalScriptIcon } from './GlobalScriptIcon'
import { QuickLaunchIconPicker, type QuickLaunchIconPatch } from './QuickLaunchIconPicker'
import { SettingsClampedNumber } from './SettingsClampedNumber'

const LANGS: ScriptLanguage[] = ['powershell', 'python', 'cmd', 'bash']

/** Hover help for Script Manager — native `title` (same as the rest of the app). */
const T = {
  search: 'Filter the library by name, description, or category.',
  new: 'Start a blank script. Save to add it to the library. Nothing is sent to AI.',
  generate:
    'Describe a task and let AI draft source. Only the task text is sent — not files or paths. Review before you Save or Run.',
  import:
    'Open a .ps1 / .py / .cmd / .sh, or a .mfescript export. Imports are untrusted — read the source before running.',
  export: 'Save this script as a .mfescript you can share or back up.',
  listItem: 'Open this script to edit or run. Saved scripts rerun locally with no AI.',
  name: 'How the script appears in this list and in the context menu.',
  language:
    'Interpreter used on Run: PowerShell, Python 3 (not 2.x), cmd, or bash. Must be on PATH (or set under Settings → Scripting and AI → Script runner).',
  description: 'Optional note for you. Also used when searching the library.',
  category:
    'Optional group name. Context menu Scripts lists items under this heading when set.',
  extensions:
    'For Selection scope: only offer this script when every selected file has one of these extensions (e.g. jpg, png). Leave empty to allow any type.',
  minSelection:
    'For Selection scope: hide the script in the context menu unless at least this many items are selected. 0 = no minimum. Ignored when Global is on.',
  global:
    'Run from its toolbar button with no folder and no selection (the strip is hidden until you save a global script). Turns off Folder, Selection, Recursive, and Context menu. External file can stay on. Set Show (icon / label / both) and Icon… like Quick Launch.',
  toolbarShow:
    'Toolbar face for this global script: icon only (name as tooltip), label only, or both — same as Quick Launch.',
  toolbarIconSize:
    'Pixel size of the toolbar glyph for this global script (12–48). Independent of Appearance → Icon size.',
  toolbarIcon:
    'Choose a Lucide glyph, a custom image, or the Windows icon for an External script file.',
  parameters:
    'One parameter per line: name|type|label|required. Types: string, int, float, bool, file, folder, choice. Required is 1 or 0. At run time each value is passed as --name value.',
  dependencies:
    'Package names to remind you about (pip / Install-Module). Shown with Copy install command — never installed automatically.',
  folder:
    'Run against the current folder. The script receives --root "<folder>" and optional --recursive.',
  selection:
    'Run against selected files/folders. Paths go in a temp UTF-8 list as --input-list (one path per line).',
  recursive:
    'When Folder is on, default to walking subfolders (--recursive). You can still change this on the Run dialog.',
  contextMenu:
    'Show this script under right-click Scripts when the current folder or selection matches scope, extensions, and min selection.',
  destructive:
    'Mark as dangerous (delete/overwrite). Shows a warning banner. Also auto-detected from source (Remove-Item, rm, del, …).',
  dryRun:
    'Script understands --dry-run (preview only, no writes). Enables the Dry run button so you can test safely.',
  external:
    'Run a .ps1 / .py / .cmd / .sh on disk instead of in-app source. Hides the editor. The file is not copied into app data.',
  externalPath: 'Absolute path to the script file to execute. Edit that file in your own editor.',
  browse: 'Pick an existing .ps1, .py, .cmd, .bat, or .sh on disk.',
  duplicate: 'Save a copy of this script in the library and open the copy.',
  revert:
    'Restore the previous editor source (after an AI modify). Does not undo Save. Disabled if there is no previous version.',
  delete: 'Remove this script from the library. Does not delete an External file on disk.',
  modifyAi:
    'Send the current source plus your instruction to AI. Files and paths are never sent. Review the result before Save. Not available for External file scripts.',
  openAi:
    'Turn on AI in Settings to generate or modify scripts. Hand-written scripts still run without AI.',
  save: 'Write this script to the library under app data. Later runs are local — no AI.',
  dryRunBtn:
    'Save if needed, then run with --dry-run. Use this when the script supports a preview pass.',
  run: 'Save if needed, then execute as your Windows user. Folder/selection scripts use the current view; Global scripts do not. Live output and Stop are in the next dialog.',
  close: 'Close Script Manager. Unsaved edits are discarded. After Dry run / Run, Close on that window returns here.'
} as const

export function ScriptManagerDialog({ selectId }: { selectId?: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const notify = useAppStore((s) => s.notify)
  const refresh = useAppStore((s) => s.refreshScriptLibrary)
  const library = useAppStore((s) => s.scriptLibrary)
  const tab = useAppStore((s) => s.activeTab())
  const selected = tab.selected
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const persistManagerBounds = useCallback(
    (next: { x: number; y: number; width: number; height: number }, maximized: boolean) => {
      void applySettingsPatch({ scriptManagerBounds: { ...next, maximized } })
    },
    [applySettingsPatch]
  )

  const [query, setQuery] = useState('')
  const [currentId, setCurrentId] = useState<string | null>(selectId ?? null)
  const [name, setName] = useState('New script')
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState<ScriptLanguage>('powershell')
  const [scopes, setScopes] = useState<ScriptScope[]>(['folder'])
  const global = isGlobalScript({ scopes })
  const [recursive, setRecursive] = useState(false)
  const [contextMenuEnabled, setContextMenuEnabled] = useState(true)
  const [destructive, setDestructive] = useState(false)
  const [dryRunSupported, setDryRunSupported] = useState(false)
  const [category, setCategory] = useState('')
  const [matchExtensions, setMatchExtensions] = useState('')
  const [minSelection, setMinSelection] = useState(0)
  const [dependencies, setDependencies] = useState('')
  const [paramLines, setParamLines] = useState('')
  const [sourceKind, setSourceKind] = useState<'managed' | 'external'>('managed')
  const [externalPath, setExternalPath] = useState('')
  const [source, setSource] = useState('')
  const [hasPrevious, setHasPrevious] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toolbarShow, setToolbarShow] = useState<ScriptToolbarShow>('label')
  const [iconSizePx, setIconSizePx] = useState(QUICK_LAUNCH_ICON_SIZE_DEFAULT)
  const [iconKind, setIconKind] = useState<ScriptDefinition['iconKind']>('lucide')
  const [iconId, setIconId] = useState<string | undefined>(undefined)
  const [lucideName, setLucideName] = useState(SCRIPT_TOOLBAR_LUCIDE_DEFAULT)
  const [lucideColor, setLucideColor] = useState(SCRIPT_TOOLBAR_LUCIDE_COLOR)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return library
    return library.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.category ?? '').toLowerCase().includes(q)
    )
  }, [library, query])

  const load = async (id: string): Promise<void> => {
    const res = await call(api.script.get({ id }))
    applyScript(res.script, res.source, res.hasPrevious)
    setCurrentId(id)
    setDirty(false)
  }

  const applyScript = (s: ScriptDefinition, src: string, prev: boolean): void => {
    setName(s.name)
    setDescription(s.description)
    setLanguage(s.language)
    setScopes(s.scopes)
    setRecursive(s.recursive)
    setContextMenuEnabled(s.contextMenuEnabled)
    setDestructive(s.destructive || looksDestructive(src))
    setDryRunSupported(s.dryRunSupported)
    setCategory(s.category)
    setMatchExtensions(s.matchExtensions.join(', '))
    setMinSelection(s.minSelection)
    setDependencies(s.dependencies.join(', '))
    setParamLines(
      s.parameters.map((p) => `${p.name}|${p.type}|${p.label}|${p.required ? '1' : '0'}`).join('\n')
    )
    setSourceKind(s.sourceKind)
    setExternalPath(s.externalPath ?? '')
    setSource(src)
    setHasPrevious(prev)
    setToolbarShow(s.toolbarShow ?? 'label')
    setIconSizePx(s.iconSizePx ?? QUICK_LAUNCH_ICON_SIZE_DEFAULT)
    setIconKind(s.iconKind ?? 'lucide')
    setIconId(s.iconId)
    setLucideName(s.lucideName || SCRIPT_TOOLBAR_LUCIDE_DEFAULT)
    setLucideColor(s.lucideColor || SCRIPT_TOOLBAR_LUCIDE_COLOR)
    setIconPickerOpen(false)
  }

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (selectId) void load(selectId).catch((e) => setError(formatError(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectId])

  const blank = (): void => {
    const d = defaultScriptDefinition()
    applyScript({ ...d, id: '', createdAt: '', updatedAt: '' }, '', false)
    setCurrentId(null)
    setDirty(false)
  }

  const save = async (): Promise<ScriptDefinition | null> => {
    setSaving(true)
    setError(null)
    try {
      const res = await call(
        api.script.upsert({
          script: {
            id: currentId ?? undefined,
            name,
            description,
            language,
            interpreter: 'auto',
            scopes,
            recursive,
            parameters: paramLines
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => {
                const [pname, ptype, plabel, req] = line.split('|')
                return {
                  name: (pname ?? 'param').trim(),
                  type: (['string', 'int', 'float', 'bool', 'file', 'folder', 'choice'].includes(
                    (ptype ?? '').trim()
                  )
                    ? (ptype ?? 'string').trim()
                    : 'string') as ScriptDefinition['parameters'][number]['type'],
                  label: (plabel ?? pname ?? '').trim(),
                  required: req === '1',
                  choices: []
                }
              }),
            contextMenuEnabled,
            destructive: destructive || looksDestructive(source),
            dryRunSupported,
            sourceKind,
            externalPath: sourceKind === 'external' ? externalPath : undefined,
            category,
            matchExtensions: matchExtensions
              .split(/[\s,;]+/)
              .map((x) => x.replace(/^\./, ''))
              .filter(Boolean),
            minSelection,
            dependencies: dependencies
              .split(/[\s,;]+/)
              .map((x) => x.trim())
              .filter(Boolean),
            toolbarShow,
            iconSizePx,
            iconKind,
            iconId: iconKind === 'custom' ? iconId : undefined,
            lucideName: lucideName || SCRIPT_TOOLBAR_LUCIDE_DEFAULT,
            lucideColor: lucideColor || SCRIPT_TOOLBAR_LUCIDE_COLOR
          },
          source
        })
      )
      setCurrentId(res.script.id)
      setDirty(false)
      await refresh()
      if (res.script.name !== name.trim()) {
        setName(res.script.name)
        notify(`Saved as “${res.script.name}” — that name was already in the library`)
      } else {
        notify('Script saved')
      }
      return res.script
    } catch (e) {
      setError(formatError(e))
      return null
    } finally {
      setSaving(false)
    }
  }

  const run = async (dryRun: boolean): Promise<void> => {
    const saved = dirty || !currentId ? await save() : library.find((s) => s.id === currentId)
    if (!saved && !currentId) return
    const id = saved?.id ?? currentId
    if (!id) return
    useAppStore.setState({ dialog: { kind: 'script-manager', selectId: id } })
    openDialog({
      kind: 'script-run',
      scriptId: id,
      name,
      mode: global
        ? 'global'
        : selected.length > 0 && scopes.includes('selection')
          ? 'selection'
          : 'folder',
      root: global ? undefined : tab.path,
      paths: global ? undefined : selected,
      recursive: global ? false : recursive,
      dryRun
    })
  }

  return (
    <ScriptModal
      className="modal-script-manager"
      title="Script Manager"
      onClose={closeDialog}
      floating={{
        saved: settings.scriptManagerBounds,
        persist: persistManagerBounds,
        minW: 640,
        minH: 420,
        defaultW: 980,
        defaultH: 720,
        allowMaximize: true
      }}
      actions={
        <>
          <div className="modal-action-start script-check-row">
            <button
              type="button"
              className="btn"
              title={T.duplicate}
              disabled={!currentId}
              onClick={() => {
                if (!currentId) return
                void call(api.script.duplicate({ id: currentId }))
                  .then(async (r) => {
                    await refresh()
                    await load(r.script.id)
                  })
                  .catch((e) => setError(formatError(e)))
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="btn"
              title={T.revert}
              disabled={!hasPrevious || !currentId}
              onClick={() => {
                if (!currentId) return
                void call(api.script.revert({ id: currentId }))
                  .then((r) => {
                    setSource(r.source)
                    setHasPrevious(false)
                    setDirty(true)
                    notify('Reverted to previous source')
                  })
                  .catch((e) => setError(formatError(e)))
              }}
            >
              Revert
            </button>
            <button
              type="button"
              className="btn danger"
              title={T.delete}
              disabled={!currentId}
              onClick={() => {
                if (!currentId) return
                if (!window.confirm(`Delete “${name}”?`)) return
                void call(api.script.delete({ id: currentId }))
                  .then(async () => {
                    await refresh()
                    blank()
                  })
                  .catch((e) => setError(formatError(e)))
              }}
            >
              Delete
            </button>
            {settings.ai.enabled ? (
              <button
                type="button"
                className="btn"
                title={T.modifyAi}
                disabled={sourceKind === 'external'}
                onClick={() => {
                  if (currentId) {
                    useAppStore.setState({ dialog: { kind: 'script-manager', selectId: currentId } })
                  }
                  openDialog({
                    kind: 'script-generate',
                    scriptId: currentId ?? undefined,
                    source,
                    language,
                    name,
                    description,
                    mode: global
                      ? 'global'
                      : selected.length > 0 && scopes.includes('selection')
                        ? 'selection'
                        : 'folder',
                    recursive: global ? false : recursive,
                    folderPath: global ? undefined : tab.path
                  })
                }}
              >
                Modify with AI…
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                title={T.openAi}
                onClick={() => {
                  openDialog({ kind: 'settings', section: 'ai' })
                }}
              >
                Open AI Settings
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn"
            title={T.save}
            onClick={() => void save()}
            disabled={saving}
          >
            Save
          </button>
          {dryRunSupported && (
            <button
              type="button"
              className="btn"
              title={T.dryRunBtn}
              onClick={() => void run(true)}
              disabled={saving}
            >
              Dry run
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            title={T.run}
            onClick={() => void run(false)}
            disabled={saving}
          >
            Run
          </button>
          <button type="button" className="btn" title={T.close} onClick={closeDialog}>
            Close
          </button>
        </>
      }
    >
      <RiskBanner />
      {error && <div className="script-banner script-banner-warn">{error}</div>}
      <div className="script-manager">
        <aside className="script-manager-list">
          <input
            type="search"
            placeholder="Search scripts"
            title={T.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="script-manager-list-actions">
            <button type="button" className="btn" title={T.new} onClick={blank}>
              New
            </button>
            <button
              type="button"
              className="btn"
              title={T.generate}
              onClick={() => {
                openDialog({
                  kind: 'script-generate',
                  mode: selected.length > 0 ? 'selection' : 'folder',
                  folderPath: tab.path
                })
              }}
            >
              Generate with AI…
            </button>
          </div>
          <ul>
            {filtered.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={s.id === currentId ? 'active' : ''}
                  aria-current={s.id === currentId ? 'true' : undefined}
                  title={s.description.trim() ? `${s.description}\n\n${T.listItem}` : T.listItem}
                  onClick={() => void load(s.id).catch((e) => setError(formatError(e)))}
                >
                  {s.name}
                  {s.category ? <span className="dim"> · {s.category}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <div className="script-manager-list-actions">
            <button
              type="button"
              className="btn"
              title={T.import}
              onClick={() => {
                void (async () => {
                  try {
                    const res = await call(api.script.importFile())
                    if (!res.imported || !res.script) return
                    if (
                      !window.confirm(
                        'Imported scripts are untrusted. Review the source before running.'
                      )
                    ) {
                      await call(api.script.delete({ id: res.script.id }))
                      await refresh()
                      return
                    }
                    await refresh()
                    await load(res.script.id)
                  } catch (e) {
                    setError(formatError(e))
                  }
                })()
              }}
            >
              Import…
            </button>
            <button
              type="button"
              className="btn"
              title={T.export}
              disabled={!currentId}
              onClick={() => {
                if (!currentId) return
                void call(api.script.exportFile({ id: currentId }))
                  .then((r) => {
                    if (r.saved) notify('Script exported')
                  })
                  .catch((e) => setError(formatError(e)))
              }}
            >
              Export…
            </button>
          </div>
        </aside>
        <div className="script-manager-editor">
          <div className="script-meta-grid">
            <div className="script-meta-primary">
              <label className="settings-field" title={T.name}>
                <span>Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
              <label className="settings-field" title={T.language}>
                <span>Language</span>
                <select
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value as ScriptLanguage)
                    setDirty(true)
                  }}
                >
                  {LANGS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                      {scriptFileExtension(l)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-field script-meta-wide" title={T.description}>
                <span>Description</span>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
              <label className="settings-field" title={T.category}>
                <span>Category</span>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
              <label className="settings-field" title={T.extensions}>
                <span>Extensions (selection)</span>
                <input
                  value={matchExtensions}
                  placeholder="jpg, png"
                  disabled={global}
                  onChange={(e) => {
                    setMatchExtensions(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
            </div>
            <div className="script-meta-secondary">
              <label className="settings-field" title={T.minSelection}>
                <span>Min selection</span>
                <input
                  type="number"
                  min={0}
                  value={minSelection}
                  disabled={global}
                  onChange={(e) => {
                    setMinSelection(Number(e.target.value) || 0)
                    setDirty(true)
                  }}
                />
              </label>
              <label className="settings-field script-global-field" title={T.global}>
                <span>Global</span>
                <span className="script-global-tick">
                  <input
                    type="checkbox"
                    checked={global}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setScopes(['global'])
                        setRecursive(false)
                        setContextMenuEnabled(false)
                        setDestructive(false)
                        setDryRunSupported(false)
                        setMatchExtensions('')
                        setMinSelection(0)
                      } else {
                        setScopes(['folder'])
                      }
                      setDirty(true)
                    }}
                  />
                  No folder or selection
                </span>
              </label>
              {global ? (
                <div className="script-toolbar-face" title={T.toolbarShow}>
                  <div className="settings-ql-icon" aria-hidden>
                    <GlobalScriptIcon
                      script={{
                        ...defaultScriptDefinition(),
                        id: currentId || 'draft',
                        createdAt: '',
                        updatedAt: '',
                        name,
                        language,
                        scopes: ['global'],
                        sourceKind,
                        externalPath: sourceKind === 'external' ? externalPath : undefined,
                        toolbarShow,
                        iconSizePx,
                        iconKind,
                        iconId,
                        lucideName,
                        lucideColor
                      }}
                      size={iconSizePx}
                    />
                  </div>
                  <label className="settings-ql-show">
                    <span className="dim">Show</span>
                    <select
                      value={toolbarShow}
                      aria-label="Toolbar face"
                      onChange={(e) => {
                        setToolbarShow(e.target.value as ScriptToolbarShow)
                        setDirty(true)
                      }}
                    >
                      <option value="icon">Icon</option>
                      <option value="label">Label</option>
                      <option value="both">Icon and label</option>
                    </select>
                  </label>
                  <label className="settings-ql-icon-size" title={T.toolbarIconSize}>
                    <span className="dim">Icon size</span>
                    <SettingsClampedNumber
                      value={iconSizePx}
                      min={QUICK_LAUNCH_ICON_SIZE_MIN}
                      max={QUICK_LAUNCH_ICON_SIZE_MAX}
                      title={T.toolbarIconSize}
                      onCommit={(n) => {
                        setIconSizePx(n)
                        setDirty(true)
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    title={T.toolbarIcon}
                    onClick={() => setIconPickerOpen(true)}
                  >
                    Icon…
                  </button>
                </div>
              ) : null}
              <label className="settings-field script-meta-wide" title={T.parameters}>
                <span>Parameters (name|type|label|required)</span>
                <textarea
                  rows={3}
                  value={paramLines}
                  placeholder="threshold|int|Threshold|1"
                  onChange={(e) => {
                    setParamLines(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
              <label className="settings-field script-meta-wide" title={T.dependencies}>
                <span>Dependencies</span>
                <input
                  value={dependencies}
                  placeholder="pillow, numpy"
                  onChange={(e) => {
                    setDependencies(e.target.value)
                    setDirty(true)
                  }}
                />
              </label>
            </div>
          </div>
          <div className="script-check-row">
            <label title={T.folder} className={global ? 'is-disabled' : undefined}>
              <input
                type="checkbox"
                checked={!global && scopes.includes('folder')}
                disabled={global}
                onChange={(e) => {
                  setScopes((cur) => {
                    const next = e.target.checked
                      ? [...new Set([...cur.filter((x) => x !== 'global'), 'folder' as const])]
                      : cur.filter((x) => x !== 'folder')
                    return next.length > 0 ? next : ['folder']
                  })
                  setDirty(true)
                }}
              />{' '}
              Folder
            </label>
            <label title={T.selection} className={global ? 'is-disabled' : undefined}>
              <input
                type="checkbox"
                checked={!global && scopes.includes('selection')}
                disabled={global}
                onChange={(e) => {
                  setScopes((cur) => {
                    const next = e.target.checked
                      ? [...new Set([...cur.filter((x) => x !== 'global'), 'selection' as const])]
                      : cur.filter((x) => x !== 'selection')
                    return next.length > 0 ? next : ['selection']
                  })
                  setDirty(true)
                }}
              />{' '}
              Selection
            </label>
            <label title={T.recursive} className={global ? 'is-disabled' : undefined}>
              <input
                type="checkbox"
                checked={!global && recursive}
                disabled={global}
                onChange={(e) => {
                  setRecursive(e.target.checked)
                  setDirty(true)
                }}
              />{' '}
              Recursive default
            </label>
            <label title={T.contextMenu} className={global ? 'is-disabled' : undefined}>
              <input
                type="checkbox"
                checked={!global && contextMenuEnabled}
                disabled={global}
                onChange={(e) => {
                  setContextMenuEnabled(e.target.checked)
                  setDirty(true)
                }}
              />{' '}
              Context menu
            </label>
            <label title={T.destructive} className={global ? 'is-disabled' : undefined}>
              <input
                type="checkbox"
                checked={destructive}
                disabled={global}
                onChange={(e) => {
                  setDestructive(e.target.checked)
                  setDirty(true)
                }}
              />{' '}
              Destructive
            </label>
            <label title={T.dryRun} className={global ? 'is-disabled' : undefined}>
              <input
                type="checkbox"
                checked={dryRunSupported}
                disabled={global}
                onChange={(e) => {
                  setDryRunSupported(e.target.checked)
                  setDirty(true)
                }}
              />{' '}
              Dry-run supported
            </label>
            <label title={T.external}>
              <input
                type="checkbox"
                checked={sourceKind === 'external'}
                onChange={(e) => {
                  setSourceKind(e.target.checked ? 'external' : 'managed')
                  setDirty(true)
                }}
              />{' '}
              External file
            </label>
          </div>
          {sourceKind === 'external' && (
            <div className="script-check-row">
              <input
                style={{ flex: 1 }}
                title={T.externalPath}
                value={externalPath}
                placeholder="Absolute path to .ps1 / .py / .cmd / .sh"
                onChange={(e) => {
                  setExternalPath(e.target.value)
                  setDirty(true)
                }}
              />
              <button
                type="button"
                className="btn"
                title={T.browse}
                onClick={() => {
                  void call(api.script.pickExternal()).then((r) => {
                    if (r.path) {
                      setExternalPath(r.path)
                      setDirty(true)
                    }
                  })
                }}
              >
                Browse…
              </button>
            </div>
          )}
          <DestructiveBanner
            source={sourceKind === 'external' ? '' : source}
            flagged={destructive}
          />
          <CopyInstall
            language={language}
            deps={dependencies
              .split(/[\s,;]+/)
              .map((x) => x.trim())
              .filter(Boolean)}
          />
          {sourceKind === 'external' ? (
            <p className="dim script-external-hint">
              This script runs the file on disk. Edit it in your own editor. Untick External file
              to write managed source in the app instead.
            </p>
          ) : (
            <SourceEditor
              language={language}
              value={source}
              onChange={(v) => {
                setSource(v)
                setDirty(true)
              }}
            />
          )}
        </div>
      </div>
      {iconPickerOpen ? (
        <QuickLaunchIconPicker
          item={
            {
              id: currentId || 'draft',
              name: name.trim() || 'Script',
              path: sourceKind === 'external' ? externalPath : '',
              args: '',
              show: toolbarShow,
              iconSizePx,
              iconKind,
              iconId,
              lucideName,
              lucideColor
            } satisfies QuickLaunchItem
          }
          titlePrefix="Script icon"
          shellTabLabel="File icon"
          shellHelp={
            sourceKind === 'external' && externalPath.trim()
              ? 'Uses the Windows glyph for the external script file.'
              : 'No external file — Save with External file, or pick Lucide / Custom image.'
          }
          onClose={() => setIconPickerOpen(false)}
          onApply={(patch: QuickLaunchIconPatch) => {
            setIconKind(patch.iconKind)
            setLucideColor(patch.lucideColor)
            if (patch.iconKind === 'custom' && patch.iconId) {
              setIconId(patch.iconId)
            } else {
              setIconId(undefined)
            }
            if (patch.iconKind === 'lucide') {
              setLucideName(patch.lucideName || SCRIPT_TOOLBAR_LUCIDE_DEFAULT)
            }
            setIconPickerOpen(false)
            setDirty(true)
          }}
        />
      ) : null}
    </ScriptModal>
  )
}
