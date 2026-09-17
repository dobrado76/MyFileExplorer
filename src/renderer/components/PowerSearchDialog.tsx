import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import {
  MAX_POWER_SEARCH_SAVED,
  newPowerSearchSavedId,
  type PowerSearchSaved,
  type SearchBookmark,
  type SearchFilter
} from '@shared/schemas/search'
import { CloseIcon } from '../lib/icons'
import { useAppStore } from '../store/appStore'
import {
  ATTRIBUTE_OPTIONS,
  DUPE_OPTIONS,
  SIZE_PRESET_OPTIONS,
  TYPE_MACRO_OPTIONS,
  buildSearchQuery,
  datePresetOptions,
  defaultPowerSearchState,
  sanitizePowerSearchState,
  type PowerSearchDatePreset,
  type PowerSearchScope,
  type PowerSearchState
} from '@shared/searchBuilder'
import { allUserMetadataFields, booleanFieldLabels } from '@shared/schemas/userMetadata'

function ModalShell({
  title,
  children,
  actions,
  actionsClassName,
  onClose
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  actionsClassName?: string
  onClose(): void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide modal-power-search" role="dialog" aria-label={title}>
        <div className="modal-title modal-title-chrome">
          <span className="modal-title-text">{title}</span>
          <button
            type="button"
            className="modal-title-btn"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="modal-body modal-body-power-search">{children}</div>
        <div className={`modal-actions${actionsClassName ? ` ${actionsClassName}` : ''}`}>
          {actions}
        </div>
      </div>
    </div>
  )
}

function toggleInList<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

type PowerSearchTabId =
  | 'name'
  | 'type'
  | 'attributes'
  | 'size'
  | 'date'
  | 'location'
  | 'advanced'
  | 'metadata'

const POWER_SEARCH_TABS: { id: PowerSearchTabId; label: string }[] = [
  { id: 'name', label: 'Name & Text' },
  { id: 'type', label: 'Type' },
  { id: 'attributes', label: 'Attributes' },
  { id: 'size', label: 'Size' },
  { id: 'date', label: 'Date' },
  { id: 'location', label: 'Location' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'metadata', label: 'Metadata' }
]

function tabIsDirty(id: PowerSearchTabId, b: PowerSearchState): boolean {
  switch (id) {
    case 'name':
      return Boolean(
        b.terms.trim() ||
          b.exclude.trim() ||
          b.excludeExtensions.trim() ||
          b.itemKind !== 'any'
      )
    case 'type':
      return b.types.length > 0 || Boolean(b.extensions.trim())
    case 'attributes':
      return b.attributes.length > 0 || b.emptyOnly
    case 'size':
      return Boolean(b.sizePreset)
    case 'date':
      return Boolean(b.dateCreated || b.dateModified || b.dateAccessed)
    case 'location':
      return Boolean(
        b.inFolder.trim() ||
          b.pathContains.trim() ||
          b.pathPrefix.trim() ||
          b.parentName.trim() ||
          b.startsWith.trim() ||
          b.endsWith.trim()
      )
    case 'advanced':
      return Boolean(
        b.dupe ||
          b.depth.trim() ||
          b.childName.trim() ||
          b.content.trim() ||
          b.noteText.trim() ||
          b.noteStatus.trim() ||
          b.hasNote ||
          b.openTodos
      )
    case 'metadata':
      return Boolean(
        (b.adsStream ?? '').trim() ||
          b.hasStream ||
          b.hasMeta ||
          b.metaFilters.length > 0
      )
    default:
      return false
  }
}

/** Full-screen builder for Everything-style search — no syntax cheat sheet required. */
export function PowerSearchDialog(): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const search = useAppStore((s) => s.search)
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const setSearchIndexedOnly = useAppStore((s) => s.setSearchIndexedOnly)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const runSearch = useAppStore((s) => s.runSearch)
  const openDialog = useAppStore((s) => s.openDialog)
  const activePath = useAppStore((s) => s.activeTab().path)
  const userMetadataSets = useMemo(() => {
    if (settings.userMetadata?.enabled !== true) return []
    return settings.userMetadata.sets ?? []
  }, [settings.userMetadata])
  const userMetadataFields = useMemo(() => {
    if (settings.userMetadata?.enabled !== true) return []
    return allUserMetadataFields(
      settings.userMetadata ?? { enabled: false, sets: [], bindings: [] }
    )
  }, [settings.userMetadata])
  const [metaSetId, setMetaSetId] = useState('')
  const metaSetFields = useMemo(() => {
    const set = userMetadataSets.find((s) => s.id === metaSetId)
    return set?.fields ?? []
  }, [userMetadataSets, metaSetId])

  const [scope, setScope] = useState<PowerSearchScope>(() =>
    search.indexedOnly ? 'indexed' : 'folder'
  )
  const [builder, setBuilder] = useState<PowerSearchState>(() => ({
    ...defaultPowerSearchState(),
    terms: search.query.trim()
  }))
  const [manualQuery, setManualQuery] = useState(false)
  const [queryText, setQueryText] = useState(() => search.query)
  const [matchPath, setMatchPath] = useState(settings.searchMatchPath)
  const [matchCase, setMatchCase] = useState(settings.searchMatchCase)
  const [wholeWord, setWholeWord] = useState(settings.searchWholeWord)
  const [regex, setRegex] = useState(settings.searchRegex)
  const [saveName, setSaveName] = useState('')
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PowerSearchTabId>('name')

  useEffect(() => {
    const fid = builder.metaFilters[0]?.fieldId
    if (!fid) return
    const owner = userMetadataSets.find((s) => s.fields.some((f) => f.id === fid))
    if (owner && owner.id !== metaSetId) setMetaSetId(owner.id)
  }, [builder.metaFilters, userMetadataSets, metaSetId])

  const builtQuery = useMemo(
    () => buildSearchQuery(builder, { userMetadataFields }),
    [builder, userMetadataFields]
  )

  useEffect(() => {
    if (!manualQuery) setQueryText(builtQuery)
  }, [builtQuery, manualQuery])

  const patchBuilder = useCallback((patch: Partial<PowerSearchState>): void => {
    setBuilder((b) => ({ ...b, ...patch }))
    setManualQuery(false)
  }, [])

  const loadBookmark = (b: SearchBookmark): void => {
    setScope(b.scope)
    setBuilder(defaultPowerSearchState())
    setMetaSetId('')
    setManualQuery(true)
    setQueryText(b.query)
  }

  const loadFilter = (f: SearchFilter): void => {
    setScope('indexed')
    setBuilder(defaultPowerSearchState())
    setMetaSetId('')
    setManualQuery(true)
    setQueryText(f.macro ? `${f.macro}:` : f.query)
  }

  const runFromDialog = (): void => {
    const q = queryText.trim()
    if (!q) return
    setSearchIndexedOnly(scope === 'indexed')
    void applySettingsPatch({
      searchMatchPath: matchPath,
      searchMatchCase: matchCase,
      searchWholeWord: wholeWord,
      searchRegex: regex
    })
    setSearchQuery(q)
    void runSearch()
    closeDialog()
  }

  const runSaved = (entry: PowerSearchSaved): void => {
    applySaved(entry)
    const q = entry.query.trim()
    if (!q) return
    setSearchIndexedOnly(scope === 'indexed')
    void applySettingsPatch({
      searchMatchPath: entry.matchPath,
      searchMatchCase: entry.matchCase,
      searchWholeWord: entry.wholeWord,
      searchRegex: entry.regex
    })
    setSearchQuery(q)
    void runSearch()
    closeDialog()
  }

  const bookmarks = settings.searchBookmarks ?? []
  const filters = settings.searchFilters ?? []
  const saved = useMemo(() => {
    const list = settings.powerSearchSaved ?? []
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [settings.powerSearchSaved])

  const applySaved = (entry: PowerSearchSaved): void => {
    const next = sanitizePowerSearchState(entry.builder)
    setBuilder(next)
    const fid = next.metaFilters[0]?.fieldId
    const owner = fid
      ? userMetadataSets.find((s) => s.fields.some((f) => f.id === fid))
      : undefined
    setMetaSetId(owner?.id ?? '')
    setMatchPath(entry.matchPath)
    setMatchCase(entry.matchCase)
    setWholeWord(entry.wholeWord)
    setRegex(entry.regex)
    setManualQuery(entry.manualQuery)
    setQueryText(entry.query)
    setSaveName(entry.name)
    setSelectedSavedId(entry.id)
  }

  const persistSaved = (next: PowerSearchSaved[]): void => {
    void applySettingsPatch({ powerSearchSaved: next.slice(0, MAX_POWER_SEARCH_SAVED) })
  }

  const saveCurrent = (replaceId: string | null): void => {
    const name = saveName.trim()
    const q = queryText.trim()
    if (!name || !q) return
    const entry: PowerSearchSaved = {
      id: replaceId ?? newPowerSearchSavedId(),
      name,
      query: q,
      builder: { ...builder },
      matchPath,
      matchCase,
      wholeWord,
      regex,
      manualQuery,
      updatedAt: Date.now()
    }
    const rest = (settings.powerSearchSaved ?? []).filter((s) => s.id !== entry.id)
    persistSaved([entry, ...rest])
    setSelectedSavedId(entry.id)
  }

  const deleteSaved = (id: string): void => {
    persistSaved((settings.powerSearchSaved ?? []).filter((s) => s.id !== id))
    if (selectedSavedId === id) setSelectedSavedId(null)
  }

  return (
    <ModalShell
      title="Power search"
      onClose={closeDialog}
      actionsClassName="modal-actions-power-search"
      actions={
        <>
          <button
            type="button"
            className="btn btn-link modal-action-start"
            onClick={() => openDialog({ kind: 'settings', section: 'search' })}
          >
            Search index settings…
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setBuilder(defaultPowerSearchState())
              setMetaSetId('')
              setManualQuery(false)
              setQueryText('')
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="btn"
            disabled={!saveName.trim() || !queryText.trim()}
            title="Save the current design. Target (folder vs index) is chosen when you Search."
            onClick={() => saveCurrent(null)}
          >
            Save as…
          </button>
          <button
            type="button"
            className="btn"
            disabled={!selectedSavedId || !saveName.trim() || !queryText.trim()}
            onClick={() => saveCurrent(selectedSavedId)}
          >
            Update
          </button>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!queryText.trim()}
            onClick={runFromDialog}
          >
            Search
          </button>
        </>
      }
    >
      <p className="power-search-lead">
        Build a search visually, save the design by name, and run it again later. Saved searches
        store the query — not the target. Scope (current folder vs indexed) is chosen each time you
        Search.
      </p>

      <div className="power-search-layout">
        <aside className="power-search-history" aria-label="Saved searches">
          <div className="power-search-history-head">Saved searches</div>
          <label className="power-search-field power-search-history-name">
            <span>Name</span>
            <input
              type="text"
              value={saveName}
              maxLength={80}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Large PNGs this week"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveName.trim() && queryText.trim()) {
                  e.preventDefault()
                  saveCurrent(selectedSavedId)
                }
              }}
            />
          </label>
          {saved.length === 0 ? (
            <p className="power-search-history-empty">
              No saved designs yet. Set up a search, give it a name, then Save as…
            </p>
          ) : (
            <ul className="power-search-history-list">
              {saved.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`power-search-history-item${
                      entry.id === selectedSavedId ? ' active' : ''
                    }`}
                    title={entry.query}
                    onClick={() => applySaved(entry)}
                    onDoubleClick={() => runSaved(entry)}
                  >
                    <span className="power-search-history-item-name">{entry.name}</span>
                    <span className="power-search-history-item-q">{entry.query}</span>
                  </button>
                  <button
                    type="button"
                    className="btn power-search-history-del"
                    title="Remove saved search"
                    onClick={() => deleteSaved(entry.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="power-search-history-hint">
            Click to load into the builder. Double-click to run with the scope selected on the
            right.
          </p>
        </aside>

        <div className="power-search-main">
      <label className="power-search-query-label" htmlFor="power-search-query">
        Query preview
      </label>
      <textarea
        id="power-search-query"
        className="power-search-query"
        rows={1}
        spellCheck={false}
        value={queryText}
        onChange={(e) => {
          setManualQuery(true)
          setQueryText(e.target.value)
        }}
        placeholder='e.g. vacation pic: dm:thisweek size:>5mb'
      />
      {manualQuery ? (
        <button
          type="button"
          className="btn btn-link power-search-sync"
          onClick={() => {
            setManualQuery(false)
            setQueryText(builtQuery)
          }}
        >
          Sync from builder below
        </button>
      ) : null}

      <div className="power-search-chrome">
        <section className="power-search-section">
          <div className="form-section">Scope</div>
          <div className="power-search-radio-row" role="radiogroup" aria-label="Search scope">
            <label className="power-search-radio">
              <input
                type="radio"
                name="power-scope"
                checked={scope === 'folder'}
                onChange={() => setScope('folder')}
              />
              Current folder
              {activePath ? (
                <span className="power-search-scope-path" title={activePath}>
                  ({activePath})
                </span>
              ) : null}
            </label>
            <label className="power-search-radio">
              <input
                type="radio"
                name="power-scope"
                checked={scope === 'indexed'}
                onChange={() => setScope('indexed')}
              />
              Indexed folders
            </label>
          </div>
        </section>

        <section className="power-search-section">
          <div className="form-section">Match</div>
          <div className="power-search-check-row">
            <label className="power-search-check">
              <input
                type="checkbox"
                checked={matchPath}
                onChange={(e) => setMatchPath(e.target.checked)}
              />
              Match path
            </label>
            <label className="power-search-check">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
              />
              Match case
            </label>
            <label className="power-search-check">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
              />
              Whole word
            </label>
            <label className="power-search-check">
              <input
                type="checkbox"
                checked={regex}
                onChange={(e) => setRegex(e.target.checked)}
              />
              Regex
            </label>
          </div>
        </section>
      </div>

      <div className="power-search-tabs" role="tablist" aria-label="Search filters">
        {POWER_SEARCH_TABS.map((t) => {
          const dirty = tabIsDirty(t.id, builder)
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`power-search-tab${active ? ' active' : ''}${dirty ? ' dirty' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {dirty ? <span className="power-search-tab-dot" aria-hidden /> : null}
            </button>
          )
        })}
      </div>

      <div className="power-search-tab-panel">
        <section
          className={`power-search-section power-search-tab-pane${tab === 'name' ? ' active' : ''}`}
          role="tabpanel"
          aria-hidden={tab !== 'name'}
        >
          <label className="power-search-field">
            <span>Name contains</span>
            <input
              type="text"
              value={builder.terms}
              onChange={(e) => patchBuilder({ terms: e.target.value })}
              placeholder="words or phrases"
              autoFocus={tab === 'name'}
            />
          </label>
          <label className="power-search-field">
            <span>Exclude</span>
            <input
              type="text"
              value={builder.exclude}
              onChange={(e) => patchBuilder({ exclude: e.target.value })}
              placeholder="terms to exclude"
            />
          </label>
          <label className="power-search-field">
            <span>Exclude extensions</span>
            <input
              type="text"
              value={builder.excludeExtensions}
              onChange={(e) => patchBuilder({ excludeExtensions: e.target.value })}
              placeholder="tmp, bak"
            />
          </label>
          <label className="power-search-field">
            <span>Item kind</span>
            <select
              value={builder.itemKind}
              onChange={(e) =>
                patchBuilder({
                  itemKind: e.target.value as PowerSearchState['itemKind']
                })
              }
            >
              <option value="any">Any</option>
              <option value="file">Files only</option>
              <option value="folder">Folders only</option>
            </select>
          </label>
        </section>

        <section
          className={`power-search-section power-search-tab-pane${tab === 'type' ? ' active' : ''}`}
          role="tabpanel"
          aria-hidden={tab !== 'type'}
        >
          <div className="search-options-chips">
            {TYPE_MACRO_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`search-options-chip${builder.types.includes(opt.id) ? ' active' : ''}`}
                onClick={() => patchBuilder({ types: toggleInList(builder.types, opt.id) })}
                tabIndex={tab === 'type' ? 0 : -1}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="power-search-field">
            <span>Extensions</span>
            <input
              type="text"
              value={builder.extensions}
              onChange={(e) => patchBuilder({ extensions: e.target.value })}
              placeholder="png, jpg, webp"
            />
          </label>
        </section>

        <section
          className={`power-search-section power-search-tab-pane${
            tab === 'attributes' ? ' active' : ''
          }`}
          role="tabpanel"
          aria-hidden={tab !== 'attributes'}
        >
          <div className="search-options-chips">
            {ATTRIBUTE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`search-options-chip${
                  builder.attributes.includes(opt.id) ? ' active' : ''
                }`}
                onClick={() =>
                  patchBuilder({ attributes: toggleInList(builder.attributes, opt.id) })
                }
                tabIndex={tab === 'attributes' ? 0 : -1}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="power-search-check">
            <input
              type="checkbox"
              checked={builder.emptyOnly}
              onChange={(e) => patchBuilder({ emptyOnly: e.target.checked })}
            />
            Empty only
          </label>
        </section>

        <section
          className={`power-search-section power-search-tab-pane${tab === 'size' ? ' active' : ''}`}
          role="tabpanel"
          aria-hidden={tab !== 'size'}
        >
          <label className="power-search-field">
            <span>Size</span>
            <select
              value={builder.sizePreset ?? ''}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'custom') {
                  patchBuilder({
                    sizePreset: 'custom',
                    sizeCustom: builder.sizeCustom || '>1mb'
                  })
                } else {
                  patchBuilder({
                    sizePreset: (v || undefined) as PowerSearchState['sizePreset']
                  })
                }
              }}
            >
              {SIZE_PRESET_OPTIONS.map((opt) => (
                <option key={opt.id || 'any'} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className={`power-search-field${
              builder.sizePreset === 'custom' ? '' : ' power-search-field-slot'
            }`}
            aria-hidden={builder.sizePreset !== 'custom'}
          >
            <span>Custom size</span>
            <input
              type="text"
              value={builder.sizeCustom}
              onChange={(e) => patchBuilder({ sizeCustom: e.target.value })}
              placeholder=">10mb  &lt;1gb"
              tabIndex={builder.sizePreset === 'custom' ? 0 : -1}
            />
          </label>
        </section>

        <section
          className={`power-search-section power-search-tab-pane${tab === 'date' ? ' active' : ''}`}
          role="tabpanel"
          aria-hidden={tab !== 'date'}
        >
          {(
            [
              {
                key: 'created' as const,
                label: 'Date created',
                preset: builder.dateCreated,
                custom: builder.dateCreatedCustom,
                options: datePresetOptions('dc'),
                setPreset: (v: PowerSearchDatePreset) => patchBuilder({ dateCreated: v }),
                setCustom: (v: string) => patchBuilder({ dateCreatedCustom: v })
              },
              {
                key: 'modified' as const,
                label: 'Date modified',
                preset: builder.dateModified,
                custom: builder.dateCustom,
                options: datePresetOptions('dm'),
                setPreset: (v: PowerSearchDatePreset) => patchBuilder({ dateModified: v }),
                setCustom: (v: string) => patchBuilder({ dateCustom: v })
              },
              {
                key: 'accessed' as const,
                label: 'Date last accessed',
                preset: builder.dateAccessed,
                custom: builder.dateAccessedCustom,
                options: datePresetOptions('da'),
                setPreset: (v: PowerSearchDatePreset) => patchBuilder({ dateAccessed: v }),
                setCustom: (v: string) => patchBuilder({ dateAccessedCustom: v })
              }
            ] as const
          ).map((field) => (
            <div key={field.key} className="power-search-date-field">
              <label className="power-search-field">
                <span>{field.label}</span>
                <select
                  value={field.preset ?? ''}
                  onChange={(e) => {
                    const v = e.target.value as PowerSearchDatePreset
                    field.setPreset(v)
                    if (v === 'custom' && !field.custom) field.setCustom('today')
                  }}
                >
                  {field.options.map((opt) => (
                    <option key={opt.id || 'any'} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className={`power-search-field${
                  field.preset === 'custom' ? '' : ' power-search-field-slot'
                }`}
                aria-hidden={field.preset !== 'custom'}
              >
                <span>Custom</span>
                <input
                  type="text"
                  value={field.custom}
                  onChange={(e) => field.setCustom(e.target.value)}
                  placeholder="today, yesterday, 2024…"
                  tabIndex={field.preset === 'custom' ? 0 : -1}
                />
              </label>
            </div>
          ))}
        </section>

        <section
          className={`power-search-section power-search-tab-pane${
            tab === 'location' ? ' active' : ''
          }`}
          role="tabpanel"
          aria-hidden={tab !== 'location'}
        >
          <label className="power-search-field">
            <span>In folder</span>
            <input
              type="text"
              value={builder.inFolder}
              onChange={(e) => patchBuilder({ inFolder: e.target.value })}
              placeholder="folder name segment"
            />
          </label>
          <label className="power-search-field">
            <span>Path contains</span>
            <input
              type="text"
              value={builder.pathContains}
              onChange={(e) => patchBuilder({ pathContains: e.target.value })}
              placeholder="path substring"
            />
          </label>
          <label className="power-search-field">
            <span>Path prefix</span>
            <input
              type="text"
              value={builder.pathPrefix}
              onChange={(e) => patchBuilder({ pathPrefix: e.target.value })}
              placeholder="C:\\Projects"
            />
          </label>
          <label className="power-search-field">
            <span>Parent name</span>
            <input
              type="text"
              value={builder.parentName}
              onChange={(e) => patchBuilder({ parentName: e.target.value })}
              placeholder="parent folder"
            />
          </label>
          <label className="power-search-field">
            <span>Name starts with</span>
            <input
              type="text"
              value={builder.startsWith}
              onChange={(e) => patchBuilder({ startsWith: e.target.value })}
            />
          </label>
          <label className="power-search-field">
            <span>Name ends with</span>
            <input
              type="text"
              value={builder.endsWith}
              onChange={(e) => patchBuilder({ endsWith: e.target.value })}
            />
          </label>
        </section>

        <section
          className={`power-search-section power-search-tab-pane${
            tab === 'advanced' ? ' active' : ''
          }`}
          role="tabpanel"
          aria-hidden={tab !== 'advanced'}
        >
          <label className="power-search-field">
            <span>Duplicates</span>
            <select
              value={builder.dupe ?? ''}
              onChange={(e) =>
                patchBuilder({
                  dupe: (e.target.value || undefined) as PowerSearchState['dupe']
                })
              }
            >
              {DUPE_OPTIONS.map((opt) => (
                <option key={opt.id || 'off'} value={opt.id}>
                  {opt.id ? opt.label : 'Off'}
                </option>
              ))}
            </select>
          </label>
          <label className="power-search-field">
            <span>Folder depth</span>
            <input
              type="text"
              value={builder.depth}
              onChange={(e) => patchBuilder({ depth: e.target.value })}
              placeholder="3 or &lt;5"
            />
          </label>
          <label className="power-search-field">
            <span>Child name</span>
            <input
              type="text"
              value={builder.childName}
              onChange={(e) => patchBuilder({ childName: e.target.value })}
              placeholder="name inside folder"
            />
          </label>
          <label className="power-search-field">
            <span>File content</span>
            <input
              type="text"
              value={builder.content}
              onChange={(e) => patchBuilder({ content: e.target.value })}
              placeholder="text inside file"
            />
          </label>
          <label className="power-search-field">
            <span>Note</span>
            <input
              type="text"
              value={builder.noteText}
              onChange={(e) => patchBuilder({ noteText: e.target.value })}
              placeholder="note text"
            />
          </label>
          <label className="power-search-field">
            <span>Note status</span>
            <input
              type="text"
              value={builder.noteStatus}
              onChange={(e) => patchBuilder({ noteStatus: e.target.value })}
              placeholder="status tag"
            />
          </label>
          <label className="power-search-check">
            <input
              type="checkbox"
              checked={builder.hasNote}
              onChange={(e) => patchBuilder({ hasNote: e.target.checked })}
            />
            Has a note
          </label>
          <label className="power-search-check">
            <input
              type="checkbox"
              checked={builder.openTodos}
              onChange={(e) => patchBuilder({ openTodos: e.target.checked })}
            />
            Open checklist
          </label>
          <p
            className={`power-search-warn${
              builder.content.trim() ? '' : ' power-search-field-slot'
            }`}
            aria-hidden={!builder.content.trim()}
          >
            Content search can be slow on large folders.
          </p>
        </section>

        <section
          className={`power-search-section power-search-tab-pane${
            tab === 'metadata' ? ' active' : ''
          }`}
          role="tabpanel"
          aria-hidden={tab !== 'metadata'}
        >
          <label className="power-search-field">
            <span>ADS stream</span>
            <input
              type="text"
              value={builder.adsStream ?? ''}
              onChange={(e) => patchBuilder({ adsStream: e.target.value })}
              placeholder="Zone.Identifier or Name=value"
              spellCheck={false}
            />
          </label>
          <label className="power-search-check">
            <input
              type="checkbox"
              checked={builder.hasStream}
              onChange={(e) => patchBuilder({ hasStream: e.target.checked })}
            />
            Has any ADS
          </label>
          <div className="power-search-meta-block">
            <div className="form-section">User metadata</div>
            {userMetadataSets.length > 0 ? (
              <>
                <label className="power-search-check">
                  <input
                    type="checkbox"
                    checked={builder.hasMeta}
                    onChange={(e) => patchBuilder({ hasMeta: e.target.checked })}
                  />
                  Has any user metadata
                </label>
                <label className="power-search-field">
                  <span>Set</span>
                  <select
                    value={metaSetId}
                    onChange={(e) => {
                      setMetaSetId(e.target.value)
                      patchBuilder({ metaFilters: [] })
                    }}
                  >
                    <option value="">(none)</option>
                    {userMetadataSets.map((set) => (
                      <option key={set.id} value={set.id}>
                        {set.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className={`power-search-field${metaSetId ? '' : ' power-search-field-slot'}`}
                  aria-hidden={!metaSetId}
                >
                  <span>Field</span>
                  <select
                    value={builder.metaFilters[0]?.fieldId ?? ''}
                    onChange={(e) => {
                      const fieldId = e.target.value
                      if (!fieldId) {
                        patchBuilder({ metaFilters: [] })
                        return
                      }
                      patchBuilder({
                        metaFilters: [
                          {
                            fieldId,
                            value: builder.metaFilters[0]?.value
                          }
                        ]
                      })
                    }}
                    tabIndex={metaSetId ? 0 : -1}
                  >
                    <option value="">(none)</option>
                    {metaSetFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                {(() => {
                  const mf = builder.metaFilters[0]
                  const field = mf?.fieldId
                    ? metaSetFields.find((f) => f.id === mf.fieldId)
                    : undefined
                  const show = Boolean(field)
                  if (field?.type === 'boolean') {
                    const labels = booleanFieldLabels(field)
                    const sel =
                      mf!.value === 'true' || mf!.value === 'false' ? mf!.value : ''
                    return (
                      <label
                        className={`power-search-field${show ? '' : ' power-search-field-slot'}`}
                        aria-hidden={!show}
                      >
                        <span>Value</span>
                        <select
                          value={sel}
                          onChange={(e) =>
                            patchBuilder({
                              metaFilters: [
                                {
                                  fieldId: field.id,
                                  value: e.target.value || undefined
                                }
                              ]
                            })
                          }
                          tabIndex={show ? 0 : -1}
                        >
                          <option value="">(any / present)</option>
                          <option value="true">{labels.trueLabel}</option>
                          <option value="false">{labels.falseLabel}</option>
                        </select>
                      </label>
                    )
                  }
                  return (
                    <label
                      className={`power-search-field${show ? '' : ' power-search-field-slot'}`}
                      aria-hidden={!show}
                    >
                      <span>Value</span>
                      <input
                        type="text"
                        value={mf?.value ?? ''}
                        onChange={(e) =>
                          field
                            ? patchBuilder({
                                metaFilters: [{ fieldId: field.id, value: e.target.value }]
                              })
                            : undefined
                        }
                        placeholder={field?.type === 'number' ? '>=4' : 'match…'}
                        tabIndex={show ? 0 : -1}
                      />
                    </label>
                  )
                })()}
              </>
            ) : (
              <p className="power-search-hint">
                Enable user metadata in Settings to filter by custom fields.
              </p>
            )}
          </div>
        </section>
      </div>

        {(bookmarks.length > 0 || filters.length > 0) && (
          <section className="power-search-section power-search-section-wide">
            <div className="form-section">Saved</div>
            {filters.length > 0 ? (
              <div className="power-search-saved-row">
                <span className="power-search-saved-label">Filters</span>
                <div className="search-options-chips">
                  {filters.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="search-options-chip"
                      title={f.query || f.macro || ''}
                      onClick={() => loadFilter(f)}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {bookmarks.length > 0 ? (
              <div className="power-search-saved-row">
                <span className="power-search-saved-label">Bookmarks</span>
                <div className="search-options-chips">
                  {bookmarks.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className="search-options-chip"
                      title={b.query}
                      onClick={() => loadBookmark(b)}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        )}
        </div>
      </div>
    </ModalShell>
  )
}
