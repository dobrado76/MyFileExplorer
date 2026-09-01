import { useEffect, useMemo, useState, type JSX } from 'react'
import type { UserMetadataField } from '@shared/schemas/userMetadata'
import { isRemoteLocation } from '@shared/remotePaths'
import { metadataScopePath, resolveMetadataSet } from '@shared/userMetadataBindings'
import { testWholeValueSync } from '@shared/userMetadataValidate'
import { useAppStore } from '../store/appStore'
import { samePath } from '../lib/paths'
import { api, call, IpcError } from '../lib/ipc'

/**
 * Editable user-metadata block pinned above Details.
 * Only renders when the path resolves to a non-null metadata set.
 */
export function UserMetadataPreview({
  path,
  isDirectory
}: {
  path: string | null
  /** When omitted, inferred from the active listing when possible. */
  isDirectory?: boolean
}): JSX.Element | null {
  const um = useAppStore((s) => s.settings.userMetadata)
  const listing = useAppStore((s) => s.listing)
  const platform = useAppStore((s) => s.platform)
  const bumpColumnMeta = useAppStore((s) => s.bumpColumnMeta)
  const notify = useAppStore((s) => s.notify)
  const columnMetaBump = useAppStore((s) => s.columnMetaBump)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  const dirFlag = useMemo(() => {
    if (isDirectory != null) return isDirectory
    if (!path) return false
    const e = listing.entries.find((en) => samePath(en.path, path))
    return e?.kind === 'dir'
  }, [isDirectory, path, listing.entries])

  const fields = useMemo(() => {
    if (!path) return [] as UserMetadataField[]
    const catalog = um ?? { enabled: false, sets: [], bindings: [] }
    const scope = metadataScopePath(path, dirFlag)
    return resolveMetadataSet(scope, catalog)?.fields ?? []
  }, [path, dirFlag, um])

  const editable =
    Boolean(path) &&
    platform === 'win32' &&
    path != null &&
    !isRemoteLocation(path) &&
    fields.length > 0

  useEffect(() => {
    if (!path || fields.length === 0) {
      setValues({})
      setLoaded(false)
      return
    }
    let cancelled = false
    setLoaded(false)
    void (async () => {
      try {
        const res = await call(api.userMetadata.getMany({ paths: [path] }))
        if (cancelled) return
        setValues({ ...(res[path]?.values ?? {}) })
      } catch {
        if (!cancelled) setValues({})
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, fields, columnMetaBump.rev, columnMetaBump.path])

  if (!editable || !path) return null

  const commitField = async (field: UserMetadataField, next: unknown): Promise<void> => {
    if (field.type === 'text' && typeof next === 'string' && next) {
      const r = testWholeValueSync(next, field.text?.validation, {
        minLength: field.text?.minLength,
        maxLength: field.text?.maxLength
      })
      if (!r.ok) {
        setErrors((e) => ({ ...e, [field.id]: r.message }))
        return
      }
    }
    setErrors((e) => {
      const n = { ...e }
      delete n[field.id]
      return n
    })
    const local = { ...values }
    if (next == null || next === '' || (Array.isArray(next) && next.length === 0)) {
      delete local[field.id]
    } else {
      local[field.id] = next
    }
    setValues(local)
    setBusy(true)
    try {
      await call(api.userMetadata.setMany({ paths: [path], values: { [field.id]: next ?? null } }))
      bumpColumnMeta(path)
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="preview-user-meta">
      <div className="preview-user-meta-title">Metadata</div>
      {!loaded ? (
        <div className="preview-user-meta-loading">Loading…</div>
      ) : (
        <div className={`preview-user-meta-form${busy ? ' is-busy' : ''}`}>
          {fields.map((field) => (
            <PreviewFieldRow
              key={field.id}
              field={field}
              value={values[field.id]}
              error={errors[field.id]}
              disabled={busy}
              onCommit={(v) => void commitField(field, v)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PreviewFieldRow({
  field,
  value,
  error,
  disabled,
  onCommit
}: {
  field: UserMetadataField
  value: unknown
  error?: string
  disabled: boolean
  onCommit(v: unknown): void
}): JSX.Element {
  if (field.type === 'boolean') {
    return (
      <label className="preview-user-meta-row preview-user-meta-check">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onCommit(e.target.checked ? true : null)}
        />
        <span>{field.name}</span>
      </label>
    )
  }
  if (field.type === 'choice') {
    return (
      <label className="preview-user-meta-row">
        <span className="preview-user-meta-label">{field.name}</span>
        <select
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onCommit(e.target.value || null)}
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
    const selected = new Set(Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [])
    return (
      <fieldset className="preview-user-meta-multi" disabled={disabled}>
        <legend>{field.name}</legend>
        {(field.choices ?? []).map((o) => (
          <label key={o.id} className="preview-user-meta-check">
            <input
              type="checkbox"
              checked={selected.has(o.id)}
              onChange={() => {
                const next = new Set(selected)
                if (next.has(o.id)) next.delete(o.id)
                else next.add(o.id)
                onCommit(next.size ? [...next] : null)
              }}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
    )
  }
  if (field.type === 'date') {
    return (
      <label className="preview-user-meta-row">
        <span className="preview-user-meta-label">{field.name}</span>
        <input
          type="date"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onCommit(e.target.value || null)}
        />
      </label>
    )
  }
  if (field.type === 'number') {
    return (
      <label className="preview-user-meta-row">
        <span className="preview-user-meta-label">{field.name}</span>
        <input
          type="text"
          inputMode="decimal"
          value={typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''}
          disabled={disabled}
          onBlur={(e) => {
            const t = e.target.value.trim()
            if (!t) {
              onCommit(null)
              return
            }
            const n = Number(t)
            onCommit(Number.isFinite(n) ? n : value)
          }}
          onChange={() => {
            /* draft until blur — controlled via value from parent after commit */
          }}
          defaultValue={typeof value === 'number' ? String(value) : ''}
          key={String(value ?? '')}
        />
      </label>
    )
  }
  // text
  return (
    <label className="preview-user-meta-row">
      <span className="preview-user-meta-label">{field.name}</span>
      <div className="preview-user-meta-text">
        <input
          type="text"
          defaultValue={typeof value === 'string' ? value : ''}
          key={String(value ?? '')}
          disabled={disabled}
          onBlur={(e) => onCommit(e.target.value.trim() || null)}
        />
        {error ? <span className="preview-user-meta-error">{error}</span> : null}
      </div>
    </label>
  )
}
