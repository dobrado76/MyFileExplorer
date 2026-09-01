import { useEffect, useState, type JSX } from 'react'
import type { UserMetadataField } from '@shared/schemas/userMetadata'
import { metadataScopePath, resolveMetadataSet } from '@shared/userMetadataBindings'
import { useAppStore } from '../store/appStore'
import { api, call, IpcError } from '../lib/ipc'
import { basename, samePath } from '../lib/paths'
import { testWholeValueSync } from '@shared/userMetadataValidate'

export function UserMetadataDialog({ paths }: { paths: string[] }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const bumpColumnMeta = useAppStore((s) => s.bumpColumnMeta)
  const notify = useAppStore((s) => s.notify)
  const um = useAppStore((s) => s.settings.userMetadata)
  const listing = useAppStore((s) => s.listing)
  const [values, setValues] = useState<Record<string, unknown>>({})
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
      const set = resolveMetadataSet(metadataScopePath(p, isDir), catalog)
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
          setValues({ ...(res[paths[0]]?.values ?? {}) })
        } else {
          setValues({})
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
  }, [paths, multi])

  const orderedFields = fields

  const setField = (field: UserMetadataField, next: unknown): void => {
    setValues((prev) => {
      const copy = { ...prev }
      if (next == null || next === '' || (Array.isArray(next) && next.length === 0)) {
        delete copy[field.id]
      } else {
        copy[field.id] = next
      }
      return copy
    })
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
    } else {
      setErrors((e) => {
        const n = { ...e }
        delete n[field.id]
        return n
      })
    }
  }

  const hasErrors = Object.keys(errors).length > 0

  const save = async (clear: boolean): Promise<void> => {
    if (hasErrors && !clear) return
    setBusy(true)
    try {
      if (clear) {
        if (multi) {
          await call(api.userMetadata.setMany({ paths, values: {} }))
        } else {
          await call(api.userMetadata.set({ path: paths[0]!, values: null }))
        }
      } else if (multi) {
        await call(api.userMetadata.setMany({ paths, values }))
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
          ) : orderedFields.length === 0 ? (
            <p className="settings-help">
              No metadata set applies to this selection. Assign a set to the folder via context menu →
              Metadata set…
            </p>
          ) : (
            <div className="user-meta-form">
              {multi && (
                <p className="settings-help">
                  Bulk edit applies the values below to every selected item (only fields you set).
                </p>
              )}
              {orderedFields.map((field) => (
                <FieldEditor
                  key={field.id}
                  field={field}
                  value={values[field.id]}
                  error={errors[field.id]}
                  onChange={(v) => setField(field, v)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => closeDialog()}>
            Cancel
          </button>
          {orderedFields.length > 0 && (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void save(true)}
                title="Remove all user metadata from the selection"
              >
                Clear
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
  onChange
}: {
  field: UserMetadataField
  value: unknown
  error?: string
  onChange(v: unknown): void
}): JSX.Element {
  const id = `um-${field.id}`
  if (field.type === 'boolean') {
    return (
      <label className="settings-toggle" htmlFor={id}>
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">{field.name}</span>
        </span>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked ? true : null)}
        />
      </label>
    )
  }
  if (field.type === 'choice') {
    return (
      <label className="settings-labeled-row" htmlFor={id}>
        <span>{field.name}</span>
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
        <legend>{field.name}</legend>
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
  if (field.type === 'number') {
    return (
      <label className="settings-labeled-row" htmlFor={id}>
        <span>{field.name}</span>
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
        <span>{field.name}</span>
        <input
          id={id}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </label>
    )
  }
  // text
  return (
    <label className="settings-labeled-row user-meta-text" htmlFor={id}>
      <span>{field.name}</span>
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
            // parent already tracks via onChange; blur re-validates
            onChange(e.target.value)
            void r
          }}
        />
        {error && <span className="user-meta-error">{error}</span>}
      </div>
    </label>
  )
}
