import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  MAX_CHOICE_OPTIONS,
  MAX_USER_METADATA_FIELDS,
  MAX_USER_METADATA_SETS,
  MAX_VALIDATION_PATTERN_LEN,
  MAX_BOOLEAN_LABEL_LEN,
  DEFAULT_BOOLEAN_TRUE_LABEL,
  DEFAULT_BOOLEAN_FALSE_LABEL,
  DEFAULT_ICON_TAG_COLOR,
  DEFAULT_ICON_TAG_NAME,
  booleanFieldLabels,
  defaultBooleanLabels,
  defaultIconTagOptionGlyph,
  fieldUsesChoiceOptions,
  newUserMetadataFieldId,
  newUserMetadataOptionId,
  newUserMetadataSetId,
  suggestFieldKey,
  userMetadataSettingsSchema,
  type UserMetadataChoiceOption,
  type UserMetadataField,
  type UserMetadataFieldType,
  type UserMetadataSettings,
  type UserMetadataSet,
  userMetadataFieldSchema
} from '@shared/schemas/userMetadata'
import {
  cloneUserMetadataSettings,
  popCatalogUndo,
  pushCatalogUndo
} from '@shared/userMetadataCatalogUndo'
import { normalizeIconPack } from '@shared/schemas/iconPack'
import {
  countBindingsForSet,
  removeBindingsForSet,
  removeMetadataBinding,
  upsertMetadataBinding
} from '@shared/userMetadataBindings'
import { compileWholeValuePattern, testWholeValueSync } from '@shared/userMetadataValidate'
import { useAppStore } from '../store/appStore'
import { basename } from '../lib/paths'
import { api, call, IpcError } from '../lib/ipc'
import { packIconElement } from '../lib/iconPacks'
import { ScriptModal } from './scriptUi'
import { TrashIcon } from '../lib/icons'
import {
  glyphIsResolvable,
  IconPicker,
  type IconPickerGlyph
} from './IconPicker'

const FIELD_TYPES: { id: UserMetadataFieldType; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'boolean', label: 'Binary' },
  { id: 'date', label: 'Date' },
  { id: 'choice', label: 'Choice' },
  { id: 'multiChoice', label: 'Multi-choice' },
  { id: 'link', label: 'Link' },
  { id: 'iconTags', label: 'Icon tags' }
]

const TYPE_LABEL: Record<UserMetadataFieldType, string> = Object.fromEntries(
  FIELD_TYPES.map((t) => [t.id, t.label])
) as Record<UserMetadataFieldType, string>

/** Active manager pane: set id, or assignments | pack | hygiene | searches. */
type ManagerTab = string

function emptyMeta(): UserMetadataSettings {
  return { enabled: false, showToolbarButton: false, sets: [], bindings: [] }
}

type Props = {
  /** Re-open Settings on this section when closing. */
  returnSection?: string
}

export function UserMetadataManagerDialog({ returnSection }: Props): JSX.Element {
  const um = useAppStore((s) => s.settings.userMetadata) ?? emptyMeta()
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const notify = useAppStore((s) => s.notify)
  const navigate = useAppStore((s) => s.navigate)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)

  const [activeTab, setActiveTab] = useState<ManagerTab>(um.sets[0]?.id ?? 'assignments')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [catalogUndo, setCatalogUndo] = useState<UserMetadataSettings[]>([])
  const catalogUndoRef = useRef(catalogUndo)
  catalogUndoRef.current = catalogUndo
  const umRef = useRef(um)
  umRef.current = um

  const activeSet =
    activeTab !== 'assignments' &&
    activeTab !== 'pack' &&
    activeTab !== 'hygiene' &&
    activeTab !== 'searches'
      ? (um.sets.find((s) => s.id === activeTab) ?? null)
      : null
  const fields = useMemo(() => activeSet?.fields ?? [], [activeSet])

  const finish = useCallback((): void => {
    if (returnSection) openDialog({ kind: 'settings', section: returnSection })
    else closeDialog()
  }, [returnSection, openDialog, closeDialog])

  const persistManagerBounds = useCallback(
    (next: { x: number; y: number; width: number; height: number }, maximized: boolean) => {
      void applySettingsPatch({ userMetadataManagerBounds: { ...next, maximized } })
    },
    [applySettingsPatch]
  )

  useEffect(() => {
    if (
      activeTab === 'assignments' ||
      activeTab === 'pack' ||
      activeTab === 'hygiene' ||
      activeTab === 'searches'
    )
      return
    if (!um.sets.some((s) => s.id === activeTab)) {
      setActiveTab(um.sets[0]?.id ?? 'assignments')
    }
  }, [um.sets, activeTab])

  useEffect(() => {
    if (editingId && !fields.some((f) => f.id === editingId)) {
      setEditingId(fields[0]?.id ?? null)
    }
  }, [fields, editingId])

  const persist = async (next: UserMetadataSettings): Promise<boolean> => {
    const parsed = userMetadataSettingsSchema.safeParse(next)
    if (!parsed.success) {
      notify(parsed.error.issues[0]?.message ?? 'Invalid metadata settings', true)
      return false
    }
    const before = cloneUserMetadataSettings(umRef.current)
    try {
      await applySettingsPatch({ userMetadata: parsed.data })
      setCatalogUndo((stack) => pushCatalogUndo(stack, before))
      return true
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
      return false
    }
  }

  const undoCatalog = useCallback(async (): Promise<void> => {
    const popped = popCatalogUndo(catalogUndoRef.current)
    if (!popped) return
    const parsed = userMetadataSettingsSchema.safeParse(popped.snapshot)
    if (!parsed.success) {
      notify(parsed.error.issues[0]?.message ?? 'Cannot restore catalog', true)
      return
    }
    try {
      await applySettingsPatch({ userMetadata: parsed.data })
      setCatalogUndo(popped.next)
      notify('Catalog restored')
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    }
  }, [applySettingsPatch, notify])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (catalogUndoRef.current.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      void undoCatalog()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [undoCatalog])

  const persistSets = async (sets: UserMetadataSet[], bindings = um.bindings): Promise<boolean> =>
    persist({ ...um, enabled: um.enabled === true, sets, bindings })

  const addSet = async (): Promise<void> => {
    if (um.sets.length >= MAX_USER_METADATA_SETS) {
      notify(`At most ${MAX_USER_METADATA_SETS} sets`, true)
      return
    }
    const set: UserMetadataSet = {
      id: newUserMetadataSetId(),
      name: `Set ${um.sets.length + 1}`,
      fields: []
    }
    if (await persistSets([...um.sets, set])) setActiveTab(set.id)
  }

  const renameSet = async (id: string, name: string): Promise<void> => {
    const next = name.trim()
    if (!next) return
    await persistSets(um.sets.map((s) => (s.id === id ? { ...s, name: next } : s)))
  }

  const deleteSet = async (id: string): Promise<void> => {
    const n = countBindingsForSet(um.bindings, id)
    const ok = window.confirm(
      n > 0
        ? `Delete this set? ${n} folder assignment(s) will be removed. Metadata values on files are kept.`
        : 'Delete this set? Metadata values on files are kept.'
    )
    if (!ok) return
    const sets = um.sets.filter((s) => s.id !== id)
    const bindings = removeBindingsForSet(um.bindings, id)
    if (await persist({ ...um, enabled: um.enabled === true, sets, bindings })) {
      if (activeTab === id) setActiveTab(sets[0]?.id ?? 'assignments')
    }
  }

  const updateSetFields = async (setId: string, nextFields: UserMetadataField[]): Promise<boolean> => {
    const sets = um.sets.map((s) => (s.id === setId ? { ...s, fields: nextFields } : s))
    return persistSets(sets)
  }

  const addField = async (): Promise<void> => {
    if (!activeSet) return
    if (fields.length >= MAX_USER_METADATA_FIELDS) {
      notify(`At most ${MAX_USER_METADATA_FIELDS} fields per set`, true)
      return
    }
    const taken = new Set(fields.map((f) => f.key))
    const name = `Field ${fields.length + 1}`
    const field: UserMetadataField = {
      id: newUserMetadataFieldId(),
      key: suggestFieldKey(name, taken),
      name,
      type: 'text',
      showAsColumn: false,
      required: false,
      showOnIcon: false
    }
    if (await updateSetFields(activeSet.id, [...fields, field])) setEditingId(field.id)
  }

  const updateField = async (
    id: string,
    patch: Partial<UserMetadataField>,
    opts?: { confirmKeyChange?: boolean }
  ): Promise<boolean> => {
    if (!activeSet) return false
    const current = fields.find((f) => f.id === id)
    if (!current) return false
    const merged = { ...current, ...patch }
    if (opts?.confirmKeyChange && patch.key != null && patch.key !== current.key) {
      const ok = window.confirm(
        'Changing the query key may break manually typed or saved Power Search queries that use the old key. Continue?'
      )
      if (!ok) return false
    }
    const parsed = userMetadataFieldSchema.safeParse(merged)
    if (!parsed.success) {
      notify(parsed.error.issues[0]?.message ?? 'Invalid field values', true)
      return false
    }
    if (parsed.data.key !== current.key && fields.some((f) => f.id !== id && f.key === parsed.data.key)) {
      notify(`Query key “${parsed.data.key}” is already used in this set`, true)
      return false
    }
    // Cross-set type compatibility
    for (const set of um.sets) {
      if (set.id === activeSet.id) continue
      const other = set.fields.find((f) => f.key === parsed.data.key)
      if (other && other.type !== parsed.data.type) {
        notify(
          `Key “${parsed.data.key}” is ${other.type} in set “${set.name}”; types must match across sets`,
          true
        )
        return false
      }
    }
    const next = fields.map((f) => (f.id === id ? parsed.data : f))
    // At most one showOnIcon per set
    if (parsed.data.showOnIcon === true) {
      for (let i = 0; i < next.length; i++) {
        const f = next[i]!
        if (f.id !== id && f.showOnIcon) next[i] = { ...f, showOnIcon: false }
      }
    }
    return updateSetFields(activeSet.id, next)
  }

  const removeField = async (id: string): Promise<void> => {
    if (!activeSet) return
    if (
      !window.confirm(
        'Remove this field definition? Existing values on files are kept (orphans) until cleared.'
      )
    ) {
      return
    }
    await updateSetFields(
      activeSet.id,
      fields.filter((f) => f.id !== id)
    )
    if (editingId === id) setEditingId(null)
  }

  const moveField = async (id: string, dir: -1 | 1): Promise<void> => {
    if (!activeSet) return
    const i = fields.findIndex((f) => f.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= fields.length) return
    const next = [...fields]
    const tmp = next[i]!
    next[i] = next[j]!
    next[j] = tmp
    await updateSetFields(activeSet.id, next)
  }

  const setNameById = (id: string | null): string => {
    if (id == null) return 'No metadata'
    return um.sets.find((s) => s.id === id)?.name ?? id
  }

  return (
    <ScriptModal
      className="modal-user-metadata-manager"
      title="User Metadata"
      titleHint="Define metadata sets, assign them to folders, and edit field catalogs. Values live on files as NTFS ADS."
      onClose={finish}
      floating={{
        saved: settings.userMetadataManagerBounds,
        persist: persistManagerBounds,
        minW: 720,
        minH: 480,
        defaultW: 980,
        defaultH: 720,
        allowMaximize: true
      }}
      actions={
        <>
          <button
            type="button"
            className="btn"
            disabled={catalogUndo.length === 0}
            title="Undo catalog change (Ctrl+Z)"
            onClick={() => void undoCatalog()}
          >
            Undo
          </button>
          {returnSection ? (
            <button type="button" className="btn" onClick={finish}>
              Back to Settings
            </button>
          ) : null}
          <button type="button" className="btn primary" onClick={finish}>
            Close
          </button>
        </>
      }
    >
      <div className="user-meta-manager">
        <div className="user-meta-manager-tabs" role="tablist" aria-label="Metadata manager">
          {um.sets.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeTab === s.id}
              className={`user-meta-manager-tab${activeTab === s.id ? ' active' : ''}`}
              onClick={() => setActiveTab(s.id)}
            >
              {s.name}
            </button>
          ))}
          <button
            type="button"
            className="user-meta-manager-tab user-meta-manager-tab-add"
            disabled={um.sets.length >= MAX_USER_METADATA_SETS}
            title={
              um.sets.length >= MAX_USER_METADATA_SETS
                ? `At most ${MAX_USER_METADATA_SETS} sets`
                : 'Add set'
            }
            onClick={() => void addSet()}
          >
            +
          </button>
          <span className="user-meta-manager-tab-spacer" aria-hidden />
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'assignments'}
            className={`user-meta-manager-tab${activeTab === 'assignments' ? ' active' : ''}`}
            onClick={() => setActiveTab('assignments')}
          >
            Assignments
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'pack'}
            className={`user-meta-manager-tab${activeTab === 'pack' ? ' active' : ''}`}
            onClick={() => setActiveTab('pack')}
          >
            Pack
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'hygiene'}
            className={`user-meta-manager-tab${activeTab === 'hygiene' ? ' active' : ''}`}
            onClick={() => setActiveTab('hygiene')}
          >
            Hygiene
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'searches'}
            className={`user-meta-manager-tab${activeTab === 'searches' ? ' active' : ''}`}
            onClick={() => setActiveTab('searches')}
          >
            Searches
          </button>
        </div>

        <div className="user-meta-manager-body">
          {activeSet ? (
            <div className="user-meta-settings">
              <div className="user-meta-manager-set-detail-bar">
                <div className="user-meta-field">
                  <span>Set name</span>
                  <input
                    type="text"
                    defaultValue={activeSet.name}
                    key={activeSet.id}
                    onBlur={(e) => void renameSet(activeSet.id, e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void deleteSet(activeSet.id)}
                >
                  Delete set
                </button>
              </div>

              <div className="user-meta-toolbar">
                <span className="user-meta-toolbar-label">
                  Fields
                  {fields.length > 0 ? (
                    <span className="user-meta-count">
                      {fields.length}/{MAX_USER_METADATA_FIELDS}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={fields.length >= MAX_USER_METADATA_FIELDS}
                  onClick={() => void addField()}
                >
                  Add field
                </button>
              </div>

              {fields.length === 0 ? (
                <p className="settings-help user-meta-empty">No fields in this set yet.</p>
              ) : (
                <ul className="user-meta-field-list">
                  {fields.map((f, idx) => {
                    const open = editingId === f.id
                    return (
                      <li key={f.id} className={open ? 'active' : ''}>
                        <div className="user-meta-field-card">
                          <div className="user-meta-field-head">
                            <button
                              type="button"
                              className="user-meta-field-pick"
                              aria-expanded={open}
                              onClick={() => setEditingId(open ? null : f.id)}
                            >
                              <span className="user-meta-field-name">{f.name}</span>
                            </button>
                            <span className="user-meta-field-type muted">
                              {TYPE_LABEL[f.type] ?? f.type}
                            </span>
                            <span className="user-meta-field-actions">
                              <button
                                type="button"
                                className="icon-btn"
                                disabled={idx === 0}
                                title="Move up"
                                aria-label="Move up"
                                onClick={() => void moveField(f.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                disabled={idx === fields.length - 1}
                                title="Move down"
                                aria-label="Move down"
                                onClick={() => void moveField(f.id, 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                title="Delete field"
                                aria-label="Delete field"
                                onClick={() => void removeField(f.id)}
                              >
                                <TrashIcon size={14} />
                              </button>
                            </span>
                          </div>
                          {open && (
                            <FieldEditor
                              key={f.id}
                              field={f}
                              onChange={(patch, opts) => updateField(f.id, patch, opts)}
                            />
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : null}

          {activeTab === 'assignments' ? (
            <div className="user-meta-settings">
              <p className="settings-help user-meta-pack-help">
                Assign a set (or No metadata) from the folder context menu. Exact assignments win
                over recursive ancestors.
              </p>
              {um.bindings.length === 0 ? (
                <p className="settings-help">No folder assignments yet.</p>
              ) : (
                <div className="settings-qa-list">
                  {[...um.bindings]
                    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }))
                    .map((entry) => (
                      <div className="settings-qa-row" key={entry.path.toLowerCase()}>
                        <div className="settings-qa-meta">
                          <span className="settings-qa-label">
                            {basename(entry.path)}
                            <span className="settings-scope-badge">
                              {entry.recursive ? 'Tree' : 'Folder'}
                            </span>
                          </span>
                          <span className="settings-qa-path" title={entry.path}>
                            {entry.path}
                          </span>
                          <span className="settings-field-hint">{setNameById(entry.setId)}</span>
                        </div>
                        <div className="settings-qa-actions">
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              void persist({
                                ...um,
                                enabled: um.enabled === true,
                                sets: um.sets,
                                bindings: upsertMetadataBinding(um.bindings, {
                                  ...entry,
                                  recursive: !entry.recursive
                                })
                              })
                            }
                          >
                            {entry.recursive ? 'Folder only' : 'Include subfolders'}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              closeDialog()
                              void navigate(entry.path)
                            }}
                          >
                            Go to
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              void persist({
                                ...um,
                                enabled: um.enabled === true,
                                sets: um.sets,
                                bindings: removeMetadataBinding(um.bindings, entry.path)
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : null}

          {activeTab === 'pack' ? <MetadataPackControls /> : null}
          {activeTab === 'hygiene' ? <MetadataHygieneControls /> : null}
          {activeTab === 'searches' ? <MetadataSavedSearches /> : null}
        </div>
      </div>
    </ScriptModal>
  )
}

function MetadataPackControls(): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<import('@shared/userMetadataPack').UserMetadataPackDryRunResult | null>(
    null
  )
  return (
    <div className="user-meta-pack">
      <div className="user-meta-pack-head">
        <span className="user-meta-section-label">Metadata pack</span>
        <div className="user-meta-pack-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                try {
                  const res = await call(api.userMetadata.exportPack({}))
                  notify(`Exported ${res.count} item(s) → ${res.path}`)
                } catch (e) {
                  if (e instanceof IpcError && e.code === 'cancelled') return
                  notify(e instanceof IpcError ? e.message : String(e), true)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Export…
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                try {
                  const res = await call(api.userMetadata.importPack({ dryRun: true }))
                  if (res.dryRun === true) {
                    setPreview(res)
                    notify(
                      `Preview: +${res.definitions.addSets} sets, +${res.definitions.addFields} fields, ${res.values.create} create / ${res.values.overwrite} overwrite / ${res.values.skipMissing} missing`
                    )
                  }
                } catch (e) {
                  if (e instanceof IpcError && e.code === 'cancelled') return
                  notify(e instanceof IpcError ? e.message : String(e), true)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Preview…
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                try {
                  const res = await call(api.userMetadata.importPack({ dryRun: false }))
                  const settings = await call(api.settings.get())
                  await applySettingsPatch({ userMetadata: settings.userMetadata })
                  setPreview(null)
                  if (res.dryRun === true) return
                  notify(
                    `Imported ${res.written} item(s)${res.definitionsMerged ? ' (definitions merged)' : ''}`
                  )
                } catch (e) {
                  if (e instanceof IpcError && e.code === 'cancelled') return
                  notify(e instanceof IpcError ? e.message : String(e), true)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Apply…
          </button>
        </div>
      </div>
      <p className="settings-help user-meta-pack-help">
        ZIP of paths → <code>mfe_meta</code> + definitions (files and folders). Use <strong>Preview…</strong> for a
        dry-run diff, then <strong>Apply…</strong>. Ids are preserved; folder bindings are not auto-created.
      </p>
      {preview ? (
        <div className="user-meta-pack-preview">
          <div className="user-meta-section-label">Last preview</div>
          <ul className="settings-help">
            <li>
              Definitions: add {preview.definitions.addSets} set(s), {preview.definitions.addFields} field(s);
              skip {preview.definitions.skipFields}; conflicts {preview.definitions.conflicts.length}
            </li>
            <li>
              Values: create {preview.values.create}, overwrite {preview.values.overwrite}, missing{' '}
              {preview.values.skipMissing}
            </li>
          </ul>
          {preview.definitions.conflicts.length > 0 ? (
            <ul className="settings-help">
              {preview.definitions.conflicts.slice(0, 12).map((c, i) => (
                <li key={`${c.setId}-${c.fieldId}-${i}`}>
                  {c.fieldId}: {c.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function MetadataHygieneControls(): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const um = useAppStore((s) => s.settings.userMetadata) ?? emptyMeta()
  const [busy, setBusy] = useState(false)
  const [orphans, setOrphans] = useState<import('@shared/userMetadataOrphans').UserMetadataOrphan[]>(
    []
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const orphanKey = (o: import('@shared/userMetadataOrphans').UserMetadataOrphan): string =>
    `${o.path}|${o.kind}|${o.fieldId}|${o.optionId ?? ''}`

  return (
    <div className="user-meta-pack">
      <div className="user-meta-pack-head">
        <span className="user-meta-section-label">Orphan hygiene</span>
        <div className="user-meta-pack-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                try {
                  const res = await call(api.userMetadata.scanOrphans({}))
                  setOrphans(res.orphans)
                  setSelected(new Set())
                  notify(`Found ${res.orphans.length} orphan value(s)`)
                } catch (e) {
                  if (e instanceof IpcError && e.code === 'cancelled') return
                  notify(e instanceof IpcError ? e.message : String(e), true)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Scan…
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || selected.size === 0}
            onClick={() => {
              void (async () => {
                const list = orphans.filter((o) => selected.has(orphanKey(o)))
                if (list.length === 0) return
                if (!window.confirm(`Clear ${list.length} orphan value(s) from disk?`)) return
                setBusy(true)
                try {
                  const res = await call(api.userMetadata.clearOrphans({ orphans: list }))
                  notify(`Cleared ${res.cleared} item(s)`)
                  setOrphans((prev) => prev.filter((o) => !selected.has(orphanKey(o))))
                  setSelected(new Set())
                } catch (e) {
                  notify(e instanceof IpcError ? e.message : String(e), true)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Clear selected
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || selected.size === 0}
            onClick={() => {
              void (async () => {
                const list = orphans.filter(
                  (o) => selected.has(orphanKey(o)) && o.kind === 'field'
                )
                if (list.length === 0) {
                  notify('Select field orphans to reconnect', true)
                  return
                }
                const keyRaw = window.prompt(
                  'Reconnect selected orphans to which catalog field key?'
                )
                const key = keyRaw?.trim()
                if (!key) return
                const fields = um.sets.flatMap((s) => s.fields)
                const to = fields.find((f) => f.key === key)
                if (!to) {
                  notify(`No field with key “${key}”`, true)
                  return
                }
                const mappings: import('@shared/userMetadataOrphans').UserMetadataOrphanReconnectMapping[] =
                  list.map((o) => ({
                    path: o.path,
                    fromFieldId: o.fieldId,
                    toFieldId: to.id
                  }))
                if (
                  !window.confirm(
                    `Reconnect ${mappings.length} orphan(s) to field “${to.name}” (${to.key})?`
                  )
                ) {
                  return
                }
                setBusy(true)
                try {
                  const res = await call(api.userMetadata.reconnectOrphans({ mappings }))
                  notify(`Remapped ${res.remapped} value(s)`)
                  const rescan = await call(api.userMetadata.scanOrphans({}))
                  setOrphans(rescan.orphans)
                  setSelected(new Set())
                } catch (e) {
                  notify(e instanceof IpcError ? e.message : String(e), true)
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            Reconnect by key
          </button>
        </div>
      </div>
      <p className="settings-help">
        Scan a folder for <code>mfe_meta</code> values whose field/option ids are no longer in the catalog.
        Clearing only removes orphan keys; catalog undo never touches ADS.
      </p>
      {orphans.length === 0 ? (
        <p className="settings-help">No orphans loaded. Click Scan…</p>
      ) : (
        <div className="user-meta-orphan-list">
          {orphans.slice(0, 500).map((o) => {
            const k = orphanKey(o)
            return (
              <label key={k} className="user-meta-check">
                <input
                  type="checkbox"
                  checked={selected.has(k)}
                  onChange={(e) => {
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(k)
                      else next.delete(k)
                      return next
                    })
                  }}
                />
                <span>
                  <code>{o.kind}</code> {o.fieldId}
                  {o.optionId ? ` / ${o.optionId}` : ''}
                  {o.keyGuess ? ` (${o.keyGuess})` : ''} — {o.path}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MetadataSavedSearches(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const openDialog = useAppStore((s) => s.openDialog)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const saved = [...(settings.powerSearchSaved ?? [])].sort((a, b) => {
    const am = (a.builder.metaFilters?.length ?? 0) > 0 ? 0 : 1
    const bm = (b.builder.metaFilters?.length ?? 0) > 0 ? 0 : 1
    if (am !== bm) return am - bm
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="user-meta-pack">
      <div className="user-meta-section-label">Saved Power Search</div>
      <p className="settings-help">
        Read-only list (meta queries first). Create and edit saves in Power Search. Run opens Power Search with
        that preset.
      </p>
      {saved.length === 0 ? (
        <p className="settings-help">No saved searches yet.</p>
      ) : (
        <div className="user-meta-saved-searches">
          {saved.map((entry) => (
            <div key={entry.id} className="user-meta-saved-search-row">
              <div>
                <strong>{entry.name}</strong>
                {(entry.builder.metaFilters?.length ?? 0) > 0 ? (
                  <span className="settings-help"> · meta</span>
                ) : null}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  closeDialog()
                  openDialog({ kind: 'power-search' })
                  // Power Search loads its own list; user double-clicks the save.
                  // Prefer notifying which preset to run.
                  useAppStore.getState().notify(`Open Power Search and run “${entry.name}”`)
                }}
              >
                Open in Power Search
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function parseOptionalInt(raw: string): number | undefined | 'invalid' {
  const t = raw.trim()
  if (!t) return undefined
  if (!/^\d+$/.test(t)) return 'invalid'
  const n = Number(t)
  if (!Number.isFinite(n)) return 'invalid'
  return n
}

function FieldEditor({
  field,
  onChange
}: {
  field: UserMetadataField
  onChange(
    patch: Partial<UserMetadataField>,
    opts?: { confirmKeyChange?: boolean }
  ): Promise<boolean>
}): JSX.Element {
  const [name, setName] = useState(field.name)
  const [key, setKey] = useState(field.key)
  const [minLen, setMinLen] = useState(
    field.text?.minLength != null ? String(field.text.minLength) : ''
  )
  const [maxLen, setMaxLen] = useState(
    field.text?.maxLength != null ? String(field.text.maxLength) : ''
  )
  const [pattern, setPattern] = useState(field.text?.validation?.pattern ?? '')
  const [ignoreCase, setIgnoreCase] = useState(field.text?.validation?.flags === 'i')
  const [message, setMessage] = useState(field.text?.validation?.message ?? '')
  const [testInput, setTestInput] = useState('')
  const labels = booleanFieldLabels(field)
  const [trueLabel, setTrueLabel] = useState(labels.trueLabel)
  const [falseLabel, setFalseLabel] = useState(labels.falseLabel)

  // Keep drafts aligned when the saved field changes (e.g. type switch).
  useEffect(() => {
    setName(field.name)
    setKey(field.key)
    setMinLen(field.text?.minLength != null ? String(field.text.minLength) : '')
    setMaxLen(field.text?.maxLength != null ? String(field.text.maxLength) : '')
    setPattern(field.text?.validation?.pattern ?? '')
    setIgnoreCase(field.text?.validation?.flags === 'i')
    setMessage(field.text?.validation?.message ?? '')
    const next = booleanFieldLabels(field)
    setTrueLabel(next.trueLabel)
    setFalseLabel(next.falseLabel)
  }, [field])

  const testResult = useMemo(() => {
    if (field.type !== 'text') return null
    const min = parseOptionalInt(minLen)
    const max = parseOptionalInt(maxLen)
    const validation = pattern.trim()
      ? {
          pattern: pattern.trim(),
          flags: (ignoreCase ? 'i' : '') as '' | 'i',
          message: message.trim() || undefined
        }
      : undefined
    return testWholeValueSync(testInput, validation, {
      minLength: typeof min === 'number' ? min : undefined,
      maxLength: typeof max === 'number' ? max : undefined
    })
  }, [field.type, testInput, minLen, maxLen, pattern, ignoreCase, message])

  const commitName = (): void => {
    const next = name.trim() || field.name
    setName(next)
    if (next !== field.name) void onChange({ name: next })
  }

  const commitKey = (): void => {
    const next = key.toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!next || !/^[a-z]/.test(next)) {
      setKey(field.key)
      return
    }
    setKey(next)
    if (next === field.key) return
    void onChange({ key: next }, { confirmKeyChange: true }).then((ok) => {
      if (!ok) setKey(field.key)
    })
  }

  const commitBooleanLabels = (): void => {
    if (field.type !== 'boolean') return
    const t = trueLabel.trim() || DEFAULT_BOOLEAN_TRUE_LABEL
    const f = falseLabel.trim() || DEFAULT_BOOLEAN_FALSE_LABEL
    setTrueLabel(t)
    setFalseLabel(f)
    const cur = booleanFieldLabels(field)
    if (t === cur.trueLabel && f === cur.falseLabel) return
    void onChange({ boolean: { trueLabel: t, falseLabel: f } })
  }

  const commitTextConstraints = (overrides?: { ignoreCase?: boolean }): void => {
    if (field.type !== 'text') return
    const min = parseOptionalInt(minLen)
    const max = parseOptionalInt(maxLen)
    if (min === 'invalid') {
      setMinLen(field.text?.minLength != null ? String(field.text.minLength) : '')
      return
    }
    if (max === 'invalid') {
      setMaxLen(field.text?.maxLength != null ? String(field.text.maxLength) : '')
      return
    }
    if (min != null && max != null && min > max) {
      setMinLen(field.text?.minLength != null ? String(field.text.minLength) : '')
      setMaxLen(field.text?.maxLength != null ? String(field.text.maxLength) : '')
      return
    }
    const ic = overrides?.ignoreCase ?? ignoreCase
    const pat = pattern.trim()
    let validation: NonNullable<UserMetadataField['text']>['validation'] | undefined
    if (!pat) {
      validation = undefined
      setPattern('')
    } else {
      const flags = (ic ? 'i' : '') as '' | 'i'
      const compiled = compileWholeValuePattern({
        pattern: pat,
        flags,
        message: message.trim() || undefined
      })
      if (!compiled.ok) {
        setPattern(field.text?.validation?.pattern ?? '')
        setIgnoreCase(field.text?.validation?.flags === 'i')
        setMessage(field.text?.validation?.message ?? '')
        window.alert(compiled.message)
        return
      }
      validation = {
        pattern: pat,
        flags,
        message: message.trim() || undefined
      }
      setPattern(pat)
      setIgnoreCase(ic)
    }
    const nextText = {
      minLength: min,
      maxLength: max,
      validation
    }
    const same =
      (field.text?.minLength ?? undefined) === nextText.minLength &&
      (field.text?.maxLength ?? undefined) === nextText.maxLength &&
      (field.text?.validation?.pattern ?? '') === (validation?.pattern ?? '') &&
      (field.text?.validation?.flags ?? '') === (validation?.flags ?? '') &&
      (field.text?.validation?.message ?? '') === (validation?.message ?? '')
    if (!same) void onChange({ text: nextText })
  }

  return (
    <div
      className="user-meta-field-editor"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="user-meta-form-grid">
        <label className="user-meta-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
          />
        </label>
        <label className="user-meta-field">
          <span>Query key</span>
          <input
            type="text"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            onBlur={commitKey}
          />
        </label>
        <label className="user-meta-field">
          <span>Type</span>
          <select
            value={field.type}
            onChange={(e) => {
              const type = e.target.value as UserMetadataFieldType
              const patch: Partial<UserMetadataField> = { type }
              if (fieldUsesChoiceOptions(type)) {
                if (field.choices && field.choices.length > 0) {
                  patch.choices =
                    type === 'iconTags'
                      ? field.choices.map((o) =>
                          o.lucideName?.trim()
                            ? o
                            : { ...o, ...defaultIconTagOptionGlyph() }
                        )
                      : field.choices
                } else {
                  patch.choices = [
                    {
                      id: newUserMetadataOptionId(),
                      key: 'option_1',
                      label: 'Option 1',
                      ...(type === 'iconTags' ? defaultIconTagOptionGlyph() : {})
                    }
                  ]
                }
              } else {
                patch.choices = undefined
              }
              if (type === 'boolean') {
                patch.boolean = field.boolean ?? defaultBooleanLabels()
              } else {
                patch.boolean = undefined
              }
              if (type !== 'text') patch.text = undefined
              void onChange(patch)
            }}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="user-meta-check">
        <input
          type="checkbox"
          checked={field.showAsColumn === true}
          onChange={(e) => void onChange({ showAsColumn: e.target.checked })}
        />
        <span>Show as Details column by default</span>
      </label>

      <label className="user-meta-check">
        <input
          type="checkbox"
          checked={field.required === true}
          onChange={(e) => void onChange({ required: e.target.checked })}
        />
        <span>Required</span>
      </label>

      <label className="user-meta-check">
        <input
          type="checkbox"
          checked={field.showOnIcon === true}
          onChange={(e) => void onChange({ showOnIcon: e.target.checked })}
        />
        <span>Show badge on icons (one per set)</span>
      </label>

      <label className="user-meta-field">
        <span>Column width hint (px)</span>
        <input
          type="number"
          min={60}
          max={480}
          placeholder="140"
          value={field.columnWidthHint ?? ''}
          onChange={(e) => {
            const t = e.target.value.trim()
            if (!t) {
              void onChange({ columnWidthHint: undefined })
              return
            }
            const n = Number(t)
            if (Number.isFinite(n)) void onChange({ columnWidthHint: Math.round(n) })
          }}
        />
      </label>

      <p className="user-meta-id" title="Immutable · ADS keys and column ids">
        Id <code>{field.id}</code>
      </p>

      {(field.type === 'choice' ||
        field.type === 'multiChoice' ||
        field.type === 'iconTags') && (
        <OptionsEditor
          options={field.choices ?? []}
          iconMode={field.type === 'iconTags'}
          onChange={(choices) => void onChange({ choices })}
        />
      )}

      {field.type === 'boolean' && (
        <div className="user-meta-subsection">
          <div className="user-meta-section-label">Binary labels</div>
          <p className="settings-help">
            Stored as true/false. Labels appear in editors, columns, and search (e.g. Yes/No, True/False,
            Todo/Done).
          </p>
          <div className="user-meta-form-grid user-meta-form-grid-2">
            <label className="user-meta-field">
              <span>True label</span>
              <input
                type="text"
                maxLength={MAX_BOOLEAN_LABEL_LEN}
                value={trueLabel}
                onChange={(e) => setTrueLabel(e.target.value)}
                onBlur={commitBooleanLabels}
              />
            </label>
            <label className="user-meta-field">
              <span>False label</span>
              <input
                type="text"
                maxLength={MAX_BOOLEAN_LABEL_LEN}
                value={falseLabel}
                onChange={(e) => setFalseLabel(e.target.value)}
                onBlur={commitBooleanLabels}
              />
            </label>
          </div>
        </div>
      )}

      {field.type === 'link' && (
        <div className="user-meta-subsection">
          <div className="user-meta-section-label">Link targets</div>
          <p className="settings-help">
            Store an http(s) URL, an absolute file/folder path, or a path relative to the item. Preview
            and Details columns can follow the link (browser / navigate / open).
          </p>
        </div>
      )}

      {field.type === 'text' && (
        <div className="user-meta-subsection">
          <div className="user-meta-section-label">Text validation</div>
          <div className="user-meta-form-grid user-meta-form-grid-2">
            <label className="user-meta-field">
              <span>Min length</span>
              <input
                type="text"
                inputMode="numeric"
                spellCheck={false}
                placeholder="optional"
                value={minLen}
                onChange={(e) => setMinLen(e.target.value.replace(/[^\d]/g, ''))}
                onBlur={() => commitTextConstraints()}
              />
            </label>
            <label className="user-meta-field">
              <span>Max length</span>
              <input
                type="text"
                inputMode="numeric"
                spellCheck={false}
                placeholder="optional"
                value={maxLen}
                onChange={(e) => setMaxLen(e.target.value.replace(/[^\d]/g, ''))}
                onBlur={() => commitTextConstraints()}
              />
            </label>
          </div>
          <label className="user-meta-field user-meta-field-full">
            <span>Pattern</span>
            <input
              type="text"
              spellCheck={false}
              placeholder="e.g. [^\\s@]+@[^\\s@]+\\.[^\\s@]+"
              maxLength={MAX_VALIDATION_PATTERN_LEN}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onBlur={() => commitTextConstraints()}
            />
          </label>
          <label className="user-meta-check">
            <input
              type="checkbox"
              checked={ignoreCase}
              disabled={!pattern.trim()}
              onChange={(e) => {
                const next = e.target.checked
                setIgnoreCase(next)
                commitTextConstraints({ ignoreCase: next })
              }}
            />
            <span>Ignore case (i)</span>
          </label>
          <label className="user-meta-field user-meta-field-full">
            <span>Error message</span>
            <input
              type="text"
              placeholder="Shown when the value fails validation"
              value={message}
              disabled={!pattern.trim()}
              onChange={(e) => setMessage(e.target.value)}
              onBlur={() => commitTextConstraints()}
            />
          </label>
          <div className="user-meta-test-strip">
            <label className="user-meta-field user-meta-field-full">
              <span>Test</span>
              <div className="user-meta-pattern-row">
                <input
                  type="text"
                  value={testInput}
                  placeholder="Try a sample value"
                  onChange={(e) => setTestInput(e.target.value)}
                />
                {testResult && (
                  <span className={testResult.ok ? 'user-meta-test-ok' : 'user-meta-error'}>
                    {testResult.ok ? 'Valid' : testResult.message}
                  </span>
                )}
              </div>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

function OptionsEditor({
  options,
  iconMode,
  onChange
}: {
  options: UserMetadataChoiceOption[]
  iconMode: boolean
  onChange(next: UserMetadataChoiceOption[]): void
}): JSX.Element {
  const add = (): void => {
    if (options.length >= MAX_CHOICE_OPTIONS) return
    const taken = new Set(options.map((o) => o.key))
    let key = `option_${options.length + 1}`
    let n = options.length + 1
    while (taken.has(key)) key = `option_${++n}`
    onChange([
      ...options,
      {
        id: newUserMetadataOptionId(),
        key,
        label: `Option ${options.length + 1}`,
        ...(iconMode ? defaultIconTagOptionGlyph() : {})
      }
    ])
  }
  const move = (id: string, dir: -1 | 1): void => {
    const i = options.findIndex((o) => o.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= options.length) return
    const next = [...options]
    const tmp = next[i]!
    next[i] = next[j]!
    next[j] = tmp
    onChange(next)
  }
  return (
    <div className="user-meta-subsection">
      <div className="user-meta-options-head">
        <span className="user-meta-section-label">{iconMode ? 'Icon tags' : 'Options'}</span>
        <button
          type="button"
          className="btn btn-tiny"
          disabled={options.length >= MAX_CHOICE_OPTIONS}
          onClick={add}
        >
          Add option
        </button>
      </div>
      {iconMode ? (
        <p className="settings-help">
          Each option is a toggleable icon. Order here is column / preview order. Labels are tooltips
          and Power Search names.
        </p>
      ) : null}
      <div className={`user-meta-option-header${iconMode ? ' is-icon-tags' : ''}`} aria-hidden>
        {iconMode ? <span>Icon</span> : null}
        <span>Label</span>
        <span>Query key</span>
        <span />
      </div>
      {options.map((o, index) => (
        <OptionRow
          key={o.id}
          option={o}
          options={options}
          index={index}
          iconMode={iconMode}
          onChange={onChange}
          onMove={move}
        />
      ))}
    </div>
  )
}

function OptionRow({
  option,
  options,
  index,
  iconMode,
  onChange,
  onMove
}: {
  option: UserMetadataChoiceOption
  options: UserMetadataChoiceOption[]
  index: number
  iconMode: boolean
  onChange(next: UserMetadataChoiceOption[]): void
  onMove(id: string, dir: -1 | 1): void
}): JSX.Element {
  const [label, setLabel] = useState(option.label)
  const [key, setKey] = useState(option.key)
  const [pickerOpen, setPickerOpen] = useState(false)
  useEffect(() => {
    setLabel(option.label)
    setKey(option.key)
  }, [option.label, option.key])

  const pack = normalizeIconPack(option.lucidePack)
  const glyphName = option.lucideName?.trim() || DEFAULT_ICON_TAG_NAME
  const glyphColor = option.lucideColor || DEFAULT_ICON_TAG_COLOR

  return (
    <div className={`user-meta-option-row${iconMode ? ' is-icon-tags' : ''}`}>
      {iconMode ? (
        <button
          type="button"
          className="btn btn-tiny user-meta-option-icon-btn"
          title="Choose icon"
          onClick={() => setPickerOpen(true)}
        >
          <span className="user-meta-option-icon-preview" style={{ color: glyphColor }}>
            {packIconElement(pack, glyphName, { size: 16, color: glyphColor, strokeWidth: 2 })}
          </span>
          Icon…
        </button>
      ) : null}
      <input
        type="text"
        value={label}
        title="Display label"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          const next = label.trim() || option.label
          setLabel(next)
          if (next !== option.label) {
            onChange(options.map((x) => (x.id === option.id ? { ...x, label: next } : x)))
          }
        }}
      />
      <input
        type="text"
        spellCheck={false}
        value={key}
        title="Query key"
        onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        onBlur={() => {
          const next = key
          if (!next || !/^[a-z]/.test(next)) {
            setKey(option.key)
            return
          }
          if (next === option.key) return
          if (options.some((x) => x.id !== option.id && x.key === next)) {
            setKey(option.key)
            return
          }
          const ok = window.confirm(
            'Changing an option query key may break typed Power Search queries. Continue?'
          )
          if (!ok) {
            setKey(option.key)
            return
          }
          onChange(options.map((x) => (x.id === option.id ? { ...x, key: next } : x)))
        }}
      />
      <div className="user-meta-option-actions">
        <button
          type="button"
          className="btn btn-tiny"
          title="Move up"
          disabled={index === 0}
          onClick={() => onMove(option.id, -1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn btn-tiny"
          title="Move down"
          disabled={index >= options.length - 1}
          onClick={() => onMove(option.id, 1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="btn btn-tiny"
          title="Remove option"
          onClick={() => onChange(options.filter((x) => x.id !== option.id))}
        >
          ×
        </button>
      </div>
      {pickerOpen ? (
        <OptionIconPicker
          initial={{
            pack,
            name: glyphName,
            color: glyphColor
          }}
          onClose={() => setPickerOpen(false)}
          onApply={(g) => {
            onChange(
              options.map((x) =>
                x.id === option.id
                  ? {
                      ...x,
                      lucideName: g.name,
                      lucideColor: g.color,
                      lucidePack: g.pack !== 'lucide' ? g.pack : undefined
                    }
                  : x
              )
            )
            setPickerOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function OptionIconPicker({
  initial,
  onClose,
  onApply
}: {
  initial: IconPickerGlyph
  onClose(): void
  onApply(g: IconPickerGlyph): void
}): JSX.Element {
  const [glyph, setGlyph] = useState<IconPickerGlyph>(initial)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="modal-backdrop user-meta-option-icon-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal modal-wide modal-tab-icon"
        role="dialog"
        aria-label="Choose icon tag"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">Icon tag</div>
        <div className="modal-body modal-body-tab-icon">
          <IconPicker
            modes={['glyph']}
            mode="glyph"
            onModeChange={() => {}}
            glyph={glyph}
            onGlyphChange={setGlyph}
            onGlyphActivate={(g) => {
              if (!glyphIsResolvable(g)) return
              onApply(g)
            }}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!glyphIsResolvable(glyph)}
            onClick={() => onApply(glyph)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
