import { useEffect, useState, type JSX } from 'react'
import type { UserMetadataField } from '@shared/schemas/userMetadata'
import { booleanFieldLabels } from '@shared/schemas/userMetadata'
import { validateUserMetadataLinkValue } from '@shared/userMetadataLink'
import { resolveMetadataSetForItem } from '@shared/userMetadataBindings'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { basename, samePath } from '../lib/paths'
import { linkBaseDirForItem } from '../lib/userMetadataLink'
import { testWholeValueSync } from '@shared/userMetadataValidate'
import { UserMetadataLinkEditor } from './UserMetadataLinkEditor'
import { UserMetadataIconTagsToggle } from './UserMetadataIconTagsToggle'

type FieldMode = 'leave' | 'set' | 'clear'

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    const sa = [...a].map(String).sort()
    const sb = [...b].map(String).sort()
    return sa.every((v, i) => v === sb[i])
  }
  return false
}

function isEmptyValue(v: unknown): boolean {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
}

function seedDefaults(
  fields: UserMetadataField[],
  loaded: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...loaded }
  for (const f of fields) {
    if (f.id in next && !isEmptyValue(next[f.id])) continue
    if (f.defaultValue === undefined || f.defaultValue === null) continue
    if (isEmptyValue(f.defaultValue)) continue
    next[f.id] = f.defaultValue
  }
  return next
}

export function UserMetadataDialog({ paths }: { paths: string[] }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const bumpColumnMeta = useAppStore((s) => s.bumpColumnMeta)
  const notify = useAppStore((s) => s.notify)
  const um = useAppStore((s) => s.settings.userMetadata)
  const listing = useAppStore((s) => s.listing)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [modes, setModes] = useState<Record<string, FieldMode>>({})
  const [varies, setVaries] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const multi = paths.length > 1
  const title = multi
    ? `Metadata (${paths.length} items)`
    : `Metadata — ${basename(paths[0] ?? '')}`

  const fields = ((): UserMetadataField[] => {
    const catalog = um ?? { enabled: false, sets: [], bindings: [] }
    let sharedId: string | null | undefined
    let sharedFields: UserMetadataField[] | null = null
    for (const p of paths) {
      const e = listing.entries.find((en) => samePath(en.path, p))
      const isDir = e?.kind === 'dir'
      const set = resolveMetadataSetForItem(p, isDir, catalog)
      if (!set) return []
      if (sharedId === undefined) {
        sharedId = set.id
        sharedFields = set.fields
      } else if (sharedId !== set.id) {
        return []
      }
    }
    return sharedFields ?? []
  })()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await call(api.userMetadata.getMany({ paths }))
        if (cancelled) return
        if (!multi && paths[0]) {
          setValues(seedDefaults(fields, { ...(res[paths[0]]?.values ?? {}) }))
          setVaries({})
          setModes({})
        } else {
          const variesNext: Record<string, boolean> = {}
          const initial: Record<string, unknown> = {}
          for (const field of fields) {
            let first: unknown = undefined
            let seen = false
            let differs = false
            for (const p of paths) {
              const v = res[p]?.values?.[field.id]
              if (!seen) {
                first = v
                seen = true
              } else if (!valuesEqual(first, v)) {
                differs = true
                break
              }
            }
            variesNext[field.id] = differs
            if (!differs && !isEmptyValue(first)) initial[field.id] = first as unknown
          }
          setVaries(variesNext)
          setValues(initial)
          setModes({})
        }
      } catch {
        /* soft */
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [paths, multi, fields])

  const setField = (field: UserMetadataField, next: unknown): void => {
    setValues((prev) => {
      const copy = { ...prev }
      if (isEmptyValue(next)) delete copy[field.id]
      else copy[field.id] = next
      return copy
    })
    if (multi) {
      setModes((m) => ({ ...m, [field.id]: 'set' }))
    }
    if (field.type === 'text' && typeof next === 'string') {
      const r = testWholeValueSync(next, field.text?.validation, {
        minLength: field.text?.minLength,
        maxLength: field.text?.maxLength
      })
      setErrors((e) => {
        const n = { ...e }
        if (r.ok) delete n[field.id]
        else n[field.id] = r.message
        return n
      })
    } else if (field.type === 'link' && typeof next === 'string') {
      const r = validateUserMetadataLinkValue(next)
      setErrors((e) => {
        const n = { ...e }
        if (r.ok) delete n[field.id]
        else n[field.id] = r.message
        return n
      })
    } else {
      setErrors((e) => {
        const n = { ...e }
        delete n[field.id]
        return n
      })
    }
  }

  const setMode = (fieldId: string, mode: FieldMode): void => {
    setModes((m) => ({ ...m, [fieldId]: mode }))
    if (mode !== 'set') {
      setErrors((e) => {
        const n = { ...e }
        delete n[fieldId]
        return n
      })
    }
  }

  const hasErrors = Object.keys(errors).length > 0

  const validateRequired = (forSave: boolean): boolean => {
    const nextErrors: Record<string, string> = { ...errors }
    let ok = true
    for (const field of fields) {
      if (!field.required) continue
      if (multi) {
        const mode = modes[field.id] ?? 'leave'
        if (mode === 'clear') {
          nextErrors[field.id] = 'Required — cannot Clear'
          ok = false
          continue
        }
        if (mode !== 'set') continue
        if (isEmptyValue(values[field.id])) {
          nextErrors[field.id] = 'Required'
          ok = false
        }
      } else if (forSave && isEmptyValue(values[field.id])) {
        nextErrors[field.id] = 'Required'
        ok = false
      }
    }
    setErrors(nextErrors)
    return ok && Object.keys(nextErrors).length === 0
  }

  const save = async (clear: boolean): Promise<void> => {
    if (!clear) {
      if (hasErrors) return
      if (!validateRequired(true)) return
    }
    setBusy(true)
    try {
      if (clear) {
        if (multi) {
          await call(api.userMetadata.setMany({ paths, values: {} }))
        } else {
          await call(api.userMetadata.set({ path: paths[0]!, values: null }))
        }
      } else if (multi) {
        const patch: Record<string, unknown> = {}
        for (const field of fields) {
          const mode = modes[field.id] ?? 'leave'
          if (mode === 'leave') continue
          if (mode === 'clear') {
            patch[field.id] = null
            continue
          }
          patch[field.id] = isEmptyValue(values[field.id]) ? null : values[field.id]
        }
        if (Object.keys(patch).length === 0) {
          closeDialog()
          return
        }
        await call(api.userMetadata.setMany({ paths, values: patch }))
      } else {
        await call(api.userMetadata.set({ path: paths[0]!, values }))
      }
      for (const p of paths) bumpColumnMeta(p)
      closeDialog()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="modal modal-user-metadata" role="dialog" aria-label={title}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">
          {!loaded ? (
            <p className="settings-help">Loading…</p>
          ) : fields.length === 0 ? (
            <p className="settings-help">
              No metadata set applies to this selection. Assign a set to the folder via context menu →
              Metadata set…
            </p>
          ) : (
            <div className="user-meta-form">
              {multi && (
                <p className="settings-help">
                  Per field: Leave (unchanged), Set, or Clear. Only Set/Clear fields are written.
                </p>
              )}
              {fields.map((field) => {
                const mode = modes[field.id] ?? 'leave'
                const showEditor = !multi || mode === 'set'
                return (
                  <div key={field.id} className="user-meta-bulk-field">
                    {multi && (
                      <div className="user-meta-bulk-mode-row">
                        <span className="user-meta-bulk-name">
                          {field.name}
                          {field.required ? ' *' : ''}
                          {varies[field.id] ? (
                            <span className="user-meta-varies" title="Values differ across selection">
                              {' '}
                              (varies)
                            </span>
                          ) : null}
                        </span>
                        <select
                          className="user-meta-bulk-mode"
                          aria-label={`${field.name} mode`}
                          value={mode}
                          onChange={(e) => setMode(field.id, e.target.value as FieldMode)}
                        >
                          <option value="leave">Leave</option>
                          <option value="set">Set</option>
                          <option value="clear">Clear</option>
                        </select>
                      </div>
                    )}
                    {showEditor && (
                      <FieldEditor
                        field={field}
                        value={values[field.id]}
                        error={errors[field.id]}
                        hideLabel={multi}
                        baseDir={
                          !multi && paths[0]
                            ? linkBaseDirForItem(
                                paths[0],
                                listing.entries.find((en) => samePath(en.path, paths[0]!))
                                  ?.kind === 'dir'
                              )
                            : null
                        }
                        onChange={(v) => setField(field, v)}
                      />
                    )}
                    {!multi && errors[field.id] && field.type !== 'text' && field.type !== 'link' ? (
                      <span className="user-meta-error">{errors[field.id]}</span>
                    ) : null}
                    {multi && mode === 'set' && errors[field.id] ? (
                      <span className="user-meta-error">{errors[field.id]}</span>
                    ) : null}
                    {multi && mode === 'clear' && errors[field.id] ? (
                      <span className="user-meta-error">{errors[field.id]}</span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => closeDialog()}>
            Cancel
          </button>
          {fields.length > 0 && (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void save(true)}
                title="Remove all user metadata from the selection"
              >
                Clear all
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busy || hasErrors}
                onClick={() => void save(false)}
              >
                Save
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function FieldEditor({
  field,
  value,
  error,
  baseDir,
  hideLabel,
  onChange
}: {
  field: UserMetadataField
  value: unknown
  error?: string
  baseDir: string | null
  hideLabel?: boolean
  onChange(v: unknown): void
}): JSX.Element {
  const id = `um-${field.id}`
  const label = hideLabel ? null : (
    <span>
      {field.name}
      {field.required ? ' *' : ''}
    </span>
  )
  if (field.type === 'boolean') {
    const labels = booleanFieldLabels(field)
    const sel = value === true ? 'true' : value === false ? 'false' : ''
    return (
      <label className="settings-labeled-row" htmlFor={id}>
        {label}
        <select
          id={id}
          value={sel}
          onChange={(e) => {
            const v = e.target.value
            onChange(v === 'true' ? true : v === 'false' ? false : null)
          }}
        >
          <option value="">—</option>
          <option value="true">{labels.trueLabel}</option>
          <option value="false">{labels.falseLabel}</option>
        </select>
      </label>
    )
  }
  if (field.type === 'choice') {
    return (
      <label className="settings-labeled-row" htmlFor={id}>
        {label}
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {(field.choices ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  }
  if (field.type === 'multiChoice') {
    const selected = new Set(Array.isArray(value) ? (value as string[]) : [])
    return (
      <fieldset className="user-meta-multichoice">
        <legend>{hideLabel ? 'Options' : field.name}</legend>
        {(field.choices ?? []).map((o) => (
          <label key={o.id} className="settings-toggle">
            <span className="settings-toggle-label">{o.label}</span>
            <input
              type="checkbox"
              checked={selected.has(o.id)}
              onChange={(e) => {
                const next = new Set(selected)
                if (e.target.checked) next.add(o.id)
                else next.delete(o.id)
                onChange([...next])
              }}
            />
          </label>
        ))}
      </fieldset>
    )
  }
  if (field.type === 'iconTags') {
    const selected = Array.isArray(value)
      ? value.filter((x): x is string => typeof x === 'string')
      : []
    return (
      <div className="settings-labeled-row user-meta-icon-tags-row">
        {label}
        <UserMetadataIconTagsToggle
          field={field}
          selectedIds={selected}
          onToggle={(optionId) => {
            const next = new Set(selected)
            if (next.has(optionId)) next.delete(optionId)
            else next.add(optionId)
            onChange(next.size ? [...next] : [])
          }}
        />
      </div>
    )
  }
  if (field.type === 'number') {
    return (
      <label className="settings-labeled-row" htmlFor={id}>
        {label}
        <input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const t = e.target.value
            onChange(t === '' ? null : Number(t))
          }}
        />
      </label>
    )
  }
  if (field.type === 'date') {
    return (
      <label className="settings-labeled-row" htmlFor={id}>
        {label}
        <input
          id={id}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </label>
    )
  }
  if (field.type === 'link') {
    const str = typeof value === 'string' ? value : ''
    return (
      <label className="settings-labeled-row user-meta-text user-meta-link-row" htmlFor={id}>
        {label}
        <UserMetadataLinkEditor
          id={id}
          value={str}
          baseDir={baseDir}
          error={error}
          onChange={(next) => onChange(next)}
        />
      </label>
    )
  }
  // text
  return (
    <label className="settings-labeled-row user-meta-text" htmlFor={id}>
      {label}
      <div className="user-meta-text-wrap">
        <input
          id={id}
          type="text"
          spellCheck={false}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            const r = testWholeValueSync(e.target.value, field.text?.validation, {
              minLength: field.text?.minLength,
              maxLength: field.text?.maxLength
            })
            onChange(e.target.value)
            void r
          }}
        />
        {error && <span className="user-meta-error">{error}</span>}
      </div>
    </label>
  )
}
