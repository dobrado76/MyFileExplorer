import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  MAX_CHOICE_OPTIONS,
  MAX_USER_METADATA_FIELDS,
  MAX_USER_METADATA_SETS,
  MAX_VALIDATION_PATTERN_LEN,
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
  countBindingsForSet,
  removeBindingsForSet,
  removeMetadataBinding,
  upsertMetadataBinding
} from '@shared/userMetadataBindings'
import { compileWholeValuePattern, testWholeValueSync } from '@shared/userMetadataValidate'
import { useAppStore } from '../store/appStore'
import { basename } from '../lib/paths'
import { api, call, IpcError } from '../lib/ipc'

const FIELD_TYPES: { id: UserMetadataFieldType; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'boolean', label: 'Yes / No' },
  { id: 'date', label: 'Date' },
  { id: 'choice', label: 'Choice' },
  { id: 'multiChoice', label: 'Multi-choice' }
]

const TYPE_LABEL: Record<UserMetadataFieldType, string> = Object.fromEntries(
  FIELD_TYPES.map((t) => [t.id, t.label])
) as Record<UserMetadataFieldType, string>

function emptyMeta(): UserMetadataSettings {
  return { enabled: false, sets: [], bindings: [] }
}

function SettingsToggle({
  id,
  label,
  hint,
  checked,
  onChange
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange(v: boolean): void
}): JSX.Element {
  return (
    <label className="settings-toggle" htmlFor={id} title={hint}>
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {hint ? <span className="settings-toggle-hint">{hint}</span> : null}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export function UserMetadataSettingsPanel(): JSX.Element {
  const um = useAppStore((s) => s.settings.userMetadata) ?? emptyMeta()
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const notify = useAppStore((s) => s.notify)
  const navigate = useAppStore((s) => s.navigate)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const [activeSetId, setActiveSetId] = useState<string | null>(um.sets[0]?.id ?? null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const activeSet = um.sets.find((s) => s.id === activeSetId) ?? um.sets[0] ?? null
  const fields = useMemo(() => activeSet?.fields ?? [], [activeSet])

  useEffect(() => {
    if (activeSetId && !um.sets.some((s) => s.id === activeSetId)) {
      setActiveSetId(um.sets[0]?.id ?? null)
    }
  }, [um.sets, activeSetId])

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
    try {
      await applySettingsPatch({ userMetadata: parsed.data })
      return true
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
      return false
    }
  }

  const persistSets = async (sets: UserMetadataSet[], bindings = um.bindings): Promise<boolean> =>
    persist({ enabled: um.enabled === true, sets, bindings })

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
    if (await persistSets([...um.sets, set])) setActiveSetId(set.id)
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
    if (await persist({ enabled: um.enabled === true, sets, bindings })) {
      if (activeSetId === id) setActiveSetId(sets[0]?.id ?? null)
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
      showAsColumn: false
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
    <div className="settings-panel user-meta-settings">
      <SettingsToggle
        id="set-um-enabled"
        label="Enable user metadata"
        hint="Off by default. When on: Context Metadata set… / Metadata…, preview editor, Details meta columns, and Power Search meta.<key>: for assigned folders."
        checked={um.enabled === true}
        onChange={(v) => void persist({ ...um, enabled: v })}
      />
      <p className="settings-help">
        Define <strong>metadata sets</strong>, then assign them to folders (or mark subtrees as No
        metadata). Values live in NTFS stream <code>mfe_meta</code>; nothing shows until a folder is
        assigned (and this feature is enabled).
      </p>

      <div className="user-meta-toolbar">
        <span className="user-meta-toolbar-label">
          Sets
          {um.sets.length > 0 ? (
            <span className="user-meta-count">
              {um.sets.length}/{MAX_USER_METADATA_SETS}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="btn"
          disabled={um.sets.length >= MAX_USER_METADATA_SETS}
          onClick={() => void addSet()}
        >
          Add set
        </button>
      </div>

      {um.sets.length === 0 ? (
        <p className="settings-help user-meta-empty">No sets yet. Add a set, then assign it to a folder.</p>
      ) : (
        <div className="user-meta-sets-row">
          <ul className="user-meta-set-list">
            {um.sets.map((s) => (
              <li key={s.id} className={s.id === activeSet?.id ? 'active' : ''}>
                <button type="button" className="user-meta-set-pick" onClick={() => setActiveSetId(s.id)}>
                  <span className="user-meta-field-name">{s.name}</span>
                  <span className="muted">{s.fields.length} field(s)</span>
                </button>
              </li>
            ))}
          </ul>
          {activeSet ? (
            <div className="user-meta-set-detail">
              <div className="user-meta-field">
                <span>Set name</span>
                <input
                  type="text"
                  defaultValue={activeSet.name}
                  key={activeSet.id}
                  onBlur={(e) => void renameSet(activeSet.id, e.target.value)}
                />
              </div>
              <button type="button" className="btn btn-tiny" onClick={() => void deleteSet(activeSet.id)}>
                Delete set
              </button>
            </div>
          ) : null}
        </div>
      )}

      {activeSet ? (
        <>
          <div className="user-meta-toolbar">
            <span className="user-meta-toolbar-label">
              Fields in “{activeSet.name}”
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
                          <span className="muted">
                            {f.key} · {TYPE_LABEL[f.type] ?? f.type}
                          </span>
                        </button>
                        <span className="user-meta-field-actions">
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={idx === 0}
                            title="Move up"
                            onClick={() => void moveField(f.id, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn-tiny"
                            disabled={idx === fields.length - 1}
                            title="Move down"
                            onClick={() => void moveField(f.id, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn btn-tiny"
                            title="Delete field"
                            onClick={() => void removeField(f.id)}
                          >
                            Delete
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
        </>
      ) : null}

      <div className="user-meta-pack">
        <div className="user-meta-pack-head">
          <span className="user-meta-section-label">Folder assignments</span>
        </div>
        <p className="settings-help user-meta-pack-help">
          Assign a set (or No metadata) from the folder context menu. Exact assignments win over
          recursive ancestors.
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

      <MetadataPackControls />
    </div>
  )
}


function MetadataPackControls(): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const [busy, setBusy] = useState(false)
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
                  const res = await call(api.userMetadata.importPack({}))
                  const settings = await call(api.settings.get())
                  await applySettingsPatch({ userMetadata: settings.userMetadata })
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
            Import…
          </button>
        </div>
      </div>
      <p className="settings-help user-meta-pack-help">
        ZIP of paths → <code>mfe_meta</code> + definitions. Distinct from Compress-to-ZIP (ADS-free).
      </p>
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

  // Keep drafts aligned when the saved field changes (e.g. type switch).
  useEffect(() => {
    setName(field.name)
    setKey(field.key)
    setMinLen(field.text?.minLength != null ? String(field.text.minLength) : '')
    setMaxLen(field.text?.maxLength != null ? String(field.text.maxLength) : '')
    setPattern(field.text?.validation?.pattern ?? '')
    setIgnoreCase(field.text?.validation?.flags === 'i')
    setMessage(field.text?.validation?.message ?? '')
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
              if (type === 'choice' || type === 'multiChoice') {
                patch.choices =
                  field.choices && field.choices.length > 0
                    ? field.choices
                    : [
                        {
                          id: newUserMetadataOptionId(),
                          key: 'option_1',
                          label: 'Option 1'
                        }
                      ]
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

      <p className="user-meta-id" title="Immutable · ADS keys and column ids">
        Id <code>{field.id}</code>
      </p>

      {(field.type === 'choice' || field.type === 'multiChoice') && (
        <OptionsEditor
          options={field.choices ?? []}
          onChange={(choices) => void onChange({ choices })}
        />
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
  onChange
}: {
  options: UserMetadataChoiceOption[]
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
      { id: newUserMetadataOptionId(), key, label: `Option ${options.length + 1}` }
    ])
  }
  return (
    <div className="user-meta-subsection">
      <div className="user-meta-options-head">
        <span className="user-meta-section-label">Options</span>
        <button
          type="button"
          className="btn btn-tiny"
          disabled={options.length >= MAX_CHOICE_OPTIONS}
          onClick={add}
        >
          Add option
        </button>
      </div>
      <div className="user-meta-option-header" aria-hidden>
        <span>Label</span>
        <span>Query key</span>
        <span />
      </div>
      {options.map((o) => (
        <OptionRow key={o.id} option={o} options={options} onChange={onChange} />
      ))}
    </div>
  )
}

function OptionRow({
  option,
  options,
  onChange
}: {
  option: UserMetadataChoiceOption
  options: UserMetadataChoiceOption[]
  onChange(next: UserMetadataChoiceOption[]): void
}): JSX.Element {
  const [label, setLabel] = useState(option.label)
  const [key, setKey] = useState(option.key)
  useEffect(() => {
    setLabel(option.label)
    setKey(option.key)
  }, [option.label, option.key])

  return (
    <div className="user-meta-option-row">
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
      <button
        type="button"
        className="btn btn-tiny"
        title="Remove option"
        onClick={() => onChange(options.filter((x) => x.id !== option.id))}
      >
        ×
      </button>
    </div>
  )
}
