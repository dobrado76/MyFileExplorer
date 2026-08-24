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
  DATE_MODIFIED_OPTIONS,
  DUPE_OPTIONS,
  SIZE_PRESET_OPTIONS,
  TYPE_MACRO_OPTIONS,
  buildSearchQuery,
  defaultPowerSearchState,
  sanitizePowerSearchState,
  type PowerSearchScope,
  type PowerSearchState
} from '@shared/searchBuilder'

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

  const builtQuery = useMemo(() => buildSearchQuery(builder), [builder])

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
    setManualQuery(true)
    setQueryText(b.query)
  }

  const loadFilter = (f: SearchFilter): void => {
    setScope('indexed')
    setBuilder(defaultPowerSearchState())
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
    setBuilder(sanitizePowerSearchState(entry.builder))
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

      <div className="power-search-grid">
        <section className="power-search-section">
          <div className="form-section">Scope</div>
          <label className="power-search-radio">
            <input
              type="radio"
              name="power-search-scope"
              checked={scope === 'indexed'}
              onChange={() => setScope('indexed')}
            />
            <span>
              <strong>Indexed roots</strong>
              <span className="power-search-hint">Fast — all folders/drives in your search index</span>
            </span>
          </label>
          <label className="power-search-radio">
            <input
              type="radio"
              name="power-search-scope"
              checked={scope === 'folder'}
              onChange={() => setScope('folder')}
            />
            <span>
              <strong>Current folder</strong>
              <span className="power-search-hint">
                Recursive under <code>{activePath}</code>
              </span>
            </span>
          </label>
        </section>

        <section className="power-search-section">
          <div className="form-section">Match</div>
          <div className="power-search-checks">
            <label>
              <input type="checkbox" checked={matchPath} onChange={(e) => setMatchPath(e.target.checked)} />
              Match path
            </label>
            <label>
              <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
              Match case
            </label>
            <label>
              <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
              Whole word
            </label>
            <label>
              <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
              Regular expression
            </label>
          </div>
        </section>

        <section className="power-search-section power-search-section-wide">
          <div className="form-section">Name &amp; text</div>
          <div className="power-search-fields">
            <label className="power-search-field">
              <span>Name contains</span>
              <input
                type="text"
                value={builder.terms}
                onChange={(e) => patchBuilder({ terms: e.target.value })}
                placeholder="words separated by spaces (AND)"
              />
            </label>
            <label className="power-search-field">
              <span>Exclude</span>
              <input
                type="text"
                value={builder.exclude}
                onChange={(e) => patchBuilder({ exclude: e.target.value })}
                placeholder="name/path text — adds !term"
              />
            </label>
          </div>
          <div className="power-search-fields">
            <label className="power-search-field">
              <span>Exclude extensions</span>
              <input
                type="text"
                value={builder.excludeExtensions}
                onChange={(e) => patchBuilder({ excludeExtensions: e.target.value })}
                placeholder="tmp;bak or .log — adds !ext:"
              />
            </label>
          </div>
          <div className="power-search-kind">
            <span className="power-search-kind-label">Item kind</span>
            {(
              [
                ['any', 'Any'],
                ['file', 'Files only'],
                ['folder', 'Folders only']
              ] as const
            ).map(([id, label]) => (
              <label key={id} className="power-search-radio-inline">
                <input
                  type="radio"
                  name="power-search-kind"
                  checked={builder.itemKind === id}
                  onChange={() => patchBuilder({ itemKind: id })}
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        <section className="power-search-section">
          <div className="form-section">Type</div>
          <div className="search-options-chips">
            {TYPE_MACRO_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`search-options-chip${builder.types.includes(t.id) ? ' active' : ''}`}
                onClick={() =>
                  patchBuilder({ types: toggleInList(builder.types, t.id) })
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <label className="power-search-field">
            <span>Extensions</span>
            <input
              type="text"
              value={builder.extensions}
              onChange={(e) => patchBuilder({ extensions: e.target.value })}
              placeholder="jpg;png;webp or pdf"
            />
          </label>
        </section>

        <section className="power-search-section">
          <div className="form-section">Attributes</div>
          <div className="search-options-chips">
            {ATTRIBUTE_OPTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`search-options-chip${builder.attributes.includes(a.id) ? ' active' : ''}`}
                onClick={() =>
                  patchBuilder({ attributes: toggleInList(builder.attributes, a.id) })
                }
              >
                {a.label}
              </button>
            ))}
          </div>
          <label className="power-search-check-inline">
            <input
              type="checkbox"
              checked={builder.emptyOnly}
              onChange={(e) => patchBuilder({ emptyOnly: e.target.checked })}
            />
            Empty files / folders only
          </label>
        </section>

        <section className="power-search-section">
          <div className="form-section">Size</div>
          <select
            value={builder.sizePreset}
            onChange={(e) => {
              const v = e.target.value as PowerSearchState['sizePreset']
              patchBuilder({
                sizePreset: v,
                sizeCustom: v === 'custom' ? builder.sizeCustom : ''
              })
            }}
          >
            {SIZE_PRESET_OPTIONS.map((o) => (
              <option key={o.id || 'any'} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {builder.sizePreset === 'custom' ? (
            <label className="power-search-field">
              <span>Size expression</span>
              <input
                type="text"
                value={builder.sizeCustom}
                onChange={(e) => patchBuilder({ sizeCustom: e.target.value })}
                placeholder=">10mb, <1gb, large"
              />
            </label>
          ) : null}
        </section>

        <section className="power-search-section">
          <div className="form-section">Date modified</div>
          <select
            value={builder.dateModified}
            onChange={(e) => {
              const v = e.target.value as PowerSearchState['dateModified']
              patchBuilder({
                dateModified: v,
                dateCustom: v === 'custom' ? builder.dateCustom : ''
              })
            }}
          >
            {DATE_MODIFIED_OPTIONS.map((o) => (
              <option key={o.id || 'any'} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {builder.dateModified === 'custom' ? (
            <label className="power-search-field">
              <span>Date expression</span>
              <input
                type="text"
                value={builder.dateCustom}
                onChange={(e) => patchBuilder({ dateCustom: e.target.value })}
                placeholder="today, yesterday, 2024-01-01"
              />
            </label>
          ) : null}
        </section>

        <section className="power-search-section power-search-section-wide">
          <div className="form-section">Location</div>
          <div className="power-search-fields power-search-fields-3">
            <label className="power-search-field">
              <span>In folder</span>
              <input
                type="text"
                value={builder.inFolder}
                onChange={(e) => patchBuilder({ inFolder: e.target.value })}
                placeholder="Projects\2024"
              />
            </label>
            <label className="power-search-field">
              <span>Path contains</span>
              <input
                type="text"
                value={builder.pathContains}
                onChange={(e) => patchBuilder({ pathContains: e.target.value })}
                placeholder="backup"
              />
            </label>
            <label className="power-search-field">
              <span>Drive / path prefix</span>
              <input
                type="text"
                value={builder.pathPrefix}
                onChange={(e) => patchBuilder({ pathPrefix: e.target.value })}
                placeholder="D:\ or D:\Photos\"
              />
            </label>
            <label className="power-search-field">
              <span>Parent folder name</span>
              <input
                type="text"
                value={builder.parentName}
                onChange={(e) => patchBuilder({ parentName: e.target.value })}
                placeholder="Screenshots"
              />
            </label>
            <label className="power-search-field">
              <span>Starts with</span>
              <input
                type="text"
                value={builder.startsWith}
                onChange={(e) => patchBuilder({ startsWith: e.target.value })}
                placeholder="IMG_"
              />
            </label>
            <label className="power-search-field">
              <span>Ends with</span>
              <input
                type="text"
                value={builder.endsWith}
                onChange={(e) => patchBuilder({ endsWith: e.target.value })}
                placeholder="_final"
              />
            </label>
          </div>
        </section>

        <section className="power-search-section power-search-section-wide">
          <div className="form-section">Advanced</div>
          <div className="power-search-fields power-search-fields-3">
            <label className="power-search-field">
              <span>Duplicates</span>
              <select
                value={builder.dupe}
                onChange={(e) => patchBuilder({ dupe: e.target.value as PowerSearchState['dupe'] })}
              >
                {DUPE_OPTIONS.map((o) => (
                  <option key={o.id || 'none'} value={o.id}>
                    {o.label}
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
                placeholder="=2, &gt;3, &lt;=5"
              />
            </label>
            <label className="power-search-field">
              <span>Child name</span>
              <input
                type="text"
                value={builder.childName}
                onChange={(e) => patchBuilder({ childName: e.target.value })}
                placeholder="file inside folder"
              />
            </label>
            <label className="power-search-field">
              <span>File content</span>
              <input
                type="text"
                value={builder.content}
                onChange={(e) => patchBuilder({ content: e.target.value })}
                placeholder="slow — scans matching files"
              />
            </label>
            <label className="power-search-field">
              <span>Note</span>
              <input
                type="text"
                value={builder.noteText}
                onChange={(e) => patchBuilder({ noteText: e.target.value })}
                placeholder="text in the attached note"
                title="Searches note text, status, and checklist (NTFS stream; read-only)"
              />
            </label>
            <label className="power-search-field">
              <span>Note status</span>
              <input
                type="text"
                value={builder.noteStatus}
                onChange={(e) => patchBuilder({ noteStatus: e.target.value })}
                placeholder="Needs review"
              />
            </label>
          </div>
          <div className="power-search-checks">
            <label className="power-search-check-inline">
              <input
                type="checkbox"
                checked={builder.hasNote}
                onChange={(e) => patchBuilder({ hasNote: e.target.checked })}
              />
              Has a note
            </label>
            <label className="power-search-check-inline">
              <input
                type="checkbox"
                checked={builder.openTodos}
                onChange={(e) => patchBuilder({ openTodos: e.target.checked })}
              />
              Open checklist items
            </label>
          </div>
          {builder.content.trim() ? (
            <p className="power-search-warn">Content search can be slow on large folders.</p>
          ) : null}
        </section>

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
      </div>
    </ModalShell>
  )
}
