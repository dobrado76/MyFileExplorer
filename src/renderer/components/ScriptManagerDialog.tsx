import { useEffect, useMemo, useState, type JSX } from 'react'
import type { ScriptDefinition, ScriptLanguage } from '@shared/schemas/scripts'
import { defaultScriptDefinition, scriptFileExtension } from '@shared/schemas/scripts'
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

const LANGS: ScriptLanguage[] = ['powershell', 'python', 'cmd', 'bash']

export function ScriptManagerDialog({ selectId }: { selectId?: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const notify = useAppStore((s) => s.notify)
  const refresh = useAppStore((s) => s.refreshScriptLibrary)
  const library = useAppStore((s) => s.scriptLibrary)
  const tab = useAppStore((s) => s.activeTab())
  const selected = tab.selected
  const settings = useAppStore((s) => s.settings)

  const [query, setQuery] = useState('')
  const [currentId, setCurrentId] = useState<string | null>(selectId ?? null)
  const [name, setName] = useState('New script')
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState<ScriptLanguage>('powershell')
  const [scopes, setScopes] = useState<Array<'folder' | 'selection'>>(['folder'])
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return library
    return library.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
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
              .filter(Boolean)
          },
          source
        })
      )
      setCurrentId(res.script.id)
      setDirty(false)
      await refresh()
      notify('Script saved')
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
    closeDialog()
    openDialog({
      kind: 'script-run',
      scriptId: id,
      name,
      mode: selected.length > 0 && scopes.includes('selection') ? 'selection' : 'folder',
      root: tab.path,
      paths: selected,
      recursive,
      dryRun
    })
  }

  return (
    <ScriptModal
      className="modal-script-manager"
      title="Script Manager"
      onClose={closeDialog}
      actions={
        <>
          <div className="modal-action-start script-check-row">
            <button
              type="button"
              className="btn"
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
                onClick={() => {
                  closeDialog()
                  openDialog({
                    kind: 'script-generate',
                    scriptId: currentId ?? undefined,
                    source,
                    language,
                    folderPath: tab.path
                  })
                }}
              >
                Modify with AI…
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  closeDialog()
                  openDialog({ kind: 'settings', section: 'ai' })
                }}
              >
                Open AI Settings
              </button>
            )}
          </div>
          <button type="button" className="btn" onClick={() => void save()} disabled={saving}>
            Save
          </button>
          {dryRunSupported && (
            <button type="button" className="btn" onClick={() => void run(true)} disabled={saving}>
              Dry run
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => void run(false)} disabled={saving}>
            Run
          </button>
          <button type="button" className="btn" onClick={closeDialog}>
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="script-manager-list-actions">
            <button type="button" className="btn" onClick={blank}>
              New
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                closeDialog()
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
            <label className="settings-field">
              <span>Name</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setDirty(true)
                }}
              />
            </label>
            <label className="settings-field">
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
            <label className="settings-field script-meta-wide">
              <span>Description</span>
              <input
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  setDirty(true)
                }}
              />
            </label>
            <label className="settings-field">
              <span>Category</span>
              <input
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value)
                  setDirty(true)
                }}
              />
            </label>
            <label className="settings-field">
              <span>Extensions (selection)</span>
              <input
                value={matchExtensions}
                placeholder="jpg, png"
                onChange={(e) => {
                  setMatchExtensions(e.target.value)
                  setDirty(true)
                }}
              />
            </label>
            <label className="settings-field">
              <span>Min selection</span>
              <input
                type="number"
                min={0}
                value={minSelection}
                onChange={(e) => {
                  setMinSelection(Number(e.target.value) || 0)
                  setDirty(true)
                }}
              />
            </label>
            <label className="settings-field script-meta-wide">
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
            <label className="settings-field script-meta-wide">
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
          <div className="script-check-row">
            <label>
              <input
                type="checkbox"
                checked={scopes.includes('folder')}
                onChange={(e) => {
                  setScopes((cur) => {
                    const next = e.target.checked
                      ? [...new Set([...cur, 'folder' as const])]
                      : cur.filter((x) => x !== 'folder')
                    return next.length > 0 ? next : ['folder']
                  })
                  setDirty(true)
                }}
              />{' '}
              Folder
            </label>
            <label>
              <input
                type="checkbox"
                checked={scopes.includes('selection')}
                onChange={(e) => {
                  setScopes((cur) => {
                    const next = e.target.checked
                      ? [...new Set([...cur, 'selection' as const])]
                      : cur.filter((x) => x !== 'selection')
                    return next.length > 0 ? next : ['selection']
                  })
                  setDirty(true)
                }}
              />{' '}
              Selection
            </label>
            <label>
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => {
                  setRecursive(e.target.checked)
                  setDirty(true)
                }}
              />{' '}
              Recursive default
            </label>
            <label>
              <input
                type="checkbox"
                checked={contextMenuEnabled}
                onChange={(e) => {
                  setContextMenuEnabled(e.target.checked)
                  setDirty(true)
                }}
              />{' '}
              Context menu
            </label>
            <label>
              <input
                type="checkbox"
                checked={destructive}
                onChange={(e) => {
                  setDestructive(e.target.checked)
                  setDirty(true)
                }}
              />{' '}
              Destructive
            </label>
            <label>
              <input
                type="checkbox"
                checked={dryRunSupported}
                onChange={(e) => {
                  setDryRunSupported(e.target.checked)
                  setDirty(true)
                }}
              />{' '}
              Dry-run supported
            </label>
            <label>
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
          <DestructiveBanner source={source} flagged={destructive} />
          <CopyInstall
            language={language}
            deps={dependencies
              .split(/[\s,;]+/)
              .map((x) => x.trim())
              .filter(Boolean)}
          />
          <SourceEditor
            language={language}
            value={source}
            onChange={(v) => {
              setSource(v)
              setDirty(true)
            }}
          />
        </div>
      </div>
    </ScriptModal>
  )
}
