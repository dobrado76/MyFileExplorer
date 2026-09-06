import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { createPortal } from 'react-dom'
import type { UserMetadataField } from '@shared/schemas/userMetadata'
import {
  booleanFieldLabels,
  formatBooleanFieldValue,
  optionById
} from '@shared/schemas/userMetadata'

function stopRow(e: ReactMouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
}

/** Click cycles false → true → clear (or false ↔ true when required). */
export function UserMetadataBooleanCell({
  field,
  text,
  onCommit
}: {
  field: UserMetadataField
  text: string
  onCommit(next: boolean | null): void
}): JSX.Element {
  const labels = booleanFieldLabels(field)
  const current: boolean | null =
    text === labels.trueLabel || text.toLowerCase() === 'true'
      ? true
      : text === labels.falseLabel || text.toLowerCase() === 'false'
        ? false
        : text
          ? text === formatBooleanFieldValue(field, true)
            ? true
            : text === formatBooleanFieldValue(field, false)
              ? false
              : null
          : null

  return (
    <button
      type="button"
      className="user-meta-cell-btn"
      title={`${field.name}: click to cycle`}
      onClick={(e) => {
        stopRow(e)
        if (field.required) {
          onCommit(current === true ? false : true)
          return
        }
        if (current === false) onCommit(true)
        else if (current === true) onCommit(null)
        else onCommit(false)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {text || '\u00a0'}
    </button>
  )
}

/** Click opens a small menu of choice options (+ Clear when not required). */
export function UserMetadataChoiceCell({
  field,
  text,
  onCommit
}: {
  field: UserMetadataField
  text: string
  onCommit(next: string | null): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ x: r.left, y: r.bottom + 2 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const currentId =
    (field.choices ?? []).find((o) => o.label === text)?.id ??
    (typeof text === 'string' && optionById(field, text) ? text : null)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="user-meta-cell-btn"
        title={`${field.name}: choose`}
        onClick={(e) => {
          stopRow(e)
          setOpen((v) => !v)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {text || '\u00a0'}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="user-meta-cell-menu"
            style={{ left: pos.x, top: pos.y }}
            role="menu"
          >
            {(field.choices ?? []).map((o) => (
              <button
                key={o.id}
                type="button"
                className={`user-meta-cell-menu-item${currentId === o.id ? ' is-active' : ''}`}
                role="menuitem"
                onClick={(e) => {
                  stopRow(e)
                  setOpen(false)
                  onCommit(o.id)
                }}
              >
                {o.label}
              </button>
            ))}
            {!field.required && (
              <button
                type="button"
                className="user-meta-cell-menu-item"
                role="menuitem"
                onClick={(e) => {
                  stopRow(e)
                  setOpen(false)
                  onCommit(null)
                }}
              >
                Clear
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  )
}

/** Click → compact date input; blur / Enter commits. */
export function UserMetadataDateCell({
  field,
  text,
  onCommit
}: {
  field: UserMetadataField
  text: string
  onCommit(next: string | null): void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(typeof text === 'string' ? text : '')
  }, [text, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim() || null
    if (field.required && !next) {
      setDraft(typeof text === 'string' ? text : '')
      return
    }
    const prev = typeof text === 'string' && text ? text : null
    if (next === prev) return
    onCommit(next)
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="user-meta-cell-btn"
        title={`${field.name}: edit date`}
        onClick={(e) => {
          stopRow(e)
          setEditing(true)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {text || '\u00a0'}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      type="date"
      className="user-meta-cell-date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(typeof text === 'string' ? text : '')
          setEditing(false)
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}

function selectedMultiChoiceIds(field: UserMetadataField, text: string): string[] {
  if (!text.trim()) return []
  const labels = text.split(';').map((s) => s.trim()).filter(Boolean)
  const out: string[] = []
  for (const label of labels) {
    const opt = (field.choices ?? []).find((o) => o.label === label || o.id === label)
    if (opt) out.push(opt.id)
  }
  return out
}

/** Multi-choice: dropdown with checkboxes; each toggle commits immediately. */
export function UserMetadataMultiChoiceCell({
  field,
  text,
  onCommit
}: {
  field: UserMetadataField
  text: string
  onCommit(next: string[] | null): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = selectedMultiChoiceIds(field, text)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ x: r.left, y: r.bottom + 2 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const toggle = (optionId: string): void => {
    const set = new Set(selected)
    if (set.has(optionId)) set.delete(optionId)
    else set.add(optionId)
    if (field.required && set.size === 0) return
    onCommit(set.size ? [...set] : null)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="user-meta-cell-btn"
        title={`${field.name}: multi-select`}
        onClick={(e) => {
          stopRow(e)
          setOpen((v) => !v)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {text || '\u00a0'}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            className="user-meta-cell-menu"
            style={{ left: pos.x, top: pos.y }}
            role="menu"
          >
            {(field.choices ?? []).map((o) => {
              const on = selected.includes(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  className={`user-meta-cell-menu-item${on ? ' is-active' : ''}`}
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={(e) => {
                    stopRow(e)
                    toggle(o.id)
                  }}
                >
                  <span className="user-meta-cell-check" aria-hidden>
                    {on ? '✓' : ''}
                  </span>
                  {o.label}
                </button>
              )
            })}
            {!field.required && selected.length > 0 ? (
              <button
                type="button"
                className="user-meta-cell-menu-item"
                role="menuitem"
                onClick={(e) => {
                  stopRow(e)
                  onCommit(null)
                }}
              >
                Clear
              </button>
            ) : null}
          </div>,
          document.body
        )}
    </>
  )
}

/** Click → inline text / number edit. */
export function UserMetadataTextCell({
  field,
  text,
  onCommit
}: {
  field: UserMetadataField
  text: string
  onCommit(next: string | number | null): void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const inputRef = useRef<HTMLInputElement>(null)
  const isNumber = field.type === 'number'

  useEffect(() => {
    if (!editing) setDraft(typeof text === 'string' ? text : '')
  }, [text, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    const trimmed = draft.trim()
    if (!trimmed) {
      if (field.required) {
        setDraft(typeof text === 'string' ? text : '')
        return
      }
      if (text) onCommit(null)
      return
    }
    if (isNumber) {
      const n = Number(trimmed)
      if (!Number.isFinite(n)) {
        setDraft(typeof text === 'string' ? text : '')
        return
      }
      if (String(n) === text || text === trimmed) return
      onCommit(n)
      return
    }
    if (trimmed === text) return
    onCommit(trimmed)
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="user-meta-cell-btn"
        title={`${field.name}: edit`}
        onClick={(e) => {
          stopRow(e)
          setEditing(true)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {text || '\u00a0'}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      type={isNumber ? 'number' : 'text'}
      className="user-meta-cell-date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(typeof text === 'string' ? text : '')
          setEditing(false)
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}
