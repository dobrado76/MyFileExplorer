import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { UserMetadataField } from '@shared/schemas/userMetadata'
import { booleanFieldLabels } from '@shared/schemas/userMetadata'
import { validateUserMetadataLinkValue } from '@shared/userMetadataLink'
import { isRemoteLocation } from '@shared/remotePaths'
import { resolveMetadataSetForItem } from '@shared/userMetadataBindings'
import { testWholeValueSync } from '@shared/userMetadataValidate'
import { useAppStore } from '../store/appStore'
import { samePath } from '../lib/paths'
import { linkBaseDirForItem } from '../lib/userMetadataLink'
import { api, call, IpcError } from '../lib/ipc'
import { UserMetadataLinkEditor } from './UserMetadataLinkEditor'
import { UserMetadataIconTagsToggle } from './UserMetadataIconTagsToggle'

/**
 * Editable user-metadata block pinned above Details.
 * Only renders when the path resolves to a non-null metadata set.
 * Field chrome stays mounted across selection changes (values soft-update).
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
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  /** Skip soft-reload right after our own save (values already optimistic). */
  const skipBumpReloadRef = useRef(false)

  const dirFlag = useMemo(() => {
    if (isDirectory != null) return isDirectory
    if (!path) return false
    const e = listing.entries.find((en) => samePath(en.path, path))
    return e?.kind === 'dir'
  }, [isDirectory, path, listing.entries])

  const fields = useMemo(() => {
    if (!path) return [] as UserMetadataField[]
    const catalog = um ?? { enabled: false, sets: [], bindings: [] }
    return resolveMetadataSetForItem(path, dirFlag, catalog)?.fields ?? []
  }, [path, dirFlag, um])

  const editable =
    Boolean(path) &&
    platform === 'win32' &&
    path != null &&
    !isRemoteLocation(path) &&
    fields.length > 0

  useEffect(() => {
    setValues({})
    setErrors({})
    skipBumpReloadRef.current = false
  }, [path])

  // Initial / path load — keep field chrome; only disable controls while fetching.
  useEffect(() => {
    if (!path || fields.length === 0) {
      setValues({})
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await call(api.userMetadata.getMany({ paths: [path] }))
        if (cancelled) return
        setValues({ ...(res[path]?.values ?? {}) })
      } catch {
        if (!cancelled) setValues({})
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, fields])

  // Soft reload when another surface edits this path (dialog, etc.) — no busy flash.
  useEffect(() => {
    if (!path || fields.length === 0) return
    if (!columnMetaBump.path || !samePath(columnMetaBump.path, path)) return
    if (skipBumpReloadRef.current) {
      skipBumpReloadRef.current = false
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await call(api.userMetadata.getMany({ paths: [path] }))
        if (cancelled) return
        setValues({ ...(res[path]?.values ?? {}) })
      } catch {
        /* keep optimistic / previous */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [columnMetaBump.rev, columnMetaBump.path, path, fields])

  if (!editable || !path) return null

  const baseDir = linkBaseDirForItem(path, dirFlag)

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
    if (field.type === 'link' && typeof next === 'string' && next) {
      const r = validateUserMetadataLinkValue(next)
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
    setSavingId(field.id)
    try {
      await call(api.userMetadata.setMany({ paths: [path], values: { [field.id]: next ?? null } }))
      skipBumpReloadRef.current = true
      bumpColumnMeta(path)
    } catch (e) {
      notify(e instanceof IpcError ? e.message : String(e), true)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="preview-user-meta">
      <div className="preview-user-meta-title">Metadata</div>
      <div className="preview-user-meta-form">
        {fields.map((field) => (
          <PreviewFieldRow
            key={field.id}
            field={field}
            value={values[field.id]}
            error={errors[field.id]}
            disabled={loading || savingId === field.id}
            baseDir={baseDir}
            onCommit={(v) => void commitField(field, v)}
          />
        ))}
      </div>
    </div>
  )
}

function PreviewFieldRow({
  field,
  value,
  error,
  disabled,
  baseDir,
  onCommit
}: {
  field: UserMetadataField
  value: unknown
  error?: string
  disabled: boolean
  baseDir: string | null
  onCommit(v: unknown): void
}): JSX.Element {
  if (field.type === 'boolean') {
    const labels = booleanFieldLabels(field)
    const sel = value === true ? 'true' : value === false ? 'false' : ''
    return (
      <label className="preview-user-meta-row">
        <span className="preview-user-meta-label">{field.name}</span>
        <select
          value={sel}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value
            onCommit(v === 'true' ? true : v === 'false' ? false : null)
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
      <div className="preview-user-meta-row preview-user-meta-row-multi">
        <span className="preview-user-meta-label">{field.name}</span>
        <fieldset className="preview-user-meta-multi" disabled={disabled} aria-label={field.name}>
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
      </div>
    )
  }
  if (field.type === 'iconTags') {
    const selected = Array.isArray(value)
      ? value.filter((x): x is string => typeof x === 'string')
      : []
    return (
      <div className="preview-user-meta-row preview-user-meta-row-icon-tags">
        <span className="preview-user-meta-label">{field.name}</span>
        <UserMetadataIconTagsToggle
          field={field}
          selectedIds={selected}
          disabled={disabled}
          onToggle={(optionId) => {
            const next = new Set(selected)
            if (next.has(optionId)) next.delete(optionId)
            else next.add(optionId)
            onCommit(next.size ? [...next] : null)
          }}
        />
      </div>
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
          key={`${field.id}:${String(value ?? '')}`}
        />
      </label>
    )
  }
  if (field.type === 'link') {
    return (
      <div className="preview-user-meta-row preview-user-meta-row-link">
        <span className="preview-user-meta-label">{field.name}</span>
        <UserMetadataLinkEditor
          value={typeof value === 'string' ? value : ''}
          baseDir={baseDir}
          disabled={disabled}
          error={error}
          compact
          onChange={() => {
            /* draft until commit */
          }}
          onCommit={onCommit}
        />
      </div>
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
          key={`${field.id}:${String(value ?? '')}`}
          disabled={disabled}
          onBlur={(e) => onCommit(e.target.value.trim() || null)}
        />
        {error ? <span className="preview-user-meta-error">{error}</span> : null}
      </div>
    </label>
  )
}

