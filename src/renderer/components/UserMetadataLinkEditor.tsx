import { useEffect, useState, type DragEvent, type JSX } from 'react'
import {
  canFollowUserMetadataLink,
  formatUserMetadataLinkPath
} from '@shared/userMetadataLink'
import {
  canRevealUserMetadataLink,
  followUserMetadataLink,
  pathFromDataTransfer,
  pickUserMetadataLinkPath,
  probeUserMetadataLinkPath,
  revealUserMetadataLink
} from '../lib/userMetadataLink'

type Props = {
  id?: string
  value: string
  baseDir: string | null
  disabled?: boolean
  error?: string
  /** Compact buttons for the preview pane. */
  compact?: boolean
  onChange(next: string): void
  /** Called on blur with trimmed value (empty → null). */
  onCommit?(next: string | null): void
}

/**
 * Shared Link field editor: text + Browse / Open / Reveal, drop-to-fill, missing-path hint.
 * Shift+Browse or Shift+drop stores a path relative to the item when possible.
 */
export function UserMetadataLinkEditor({
  id,
  value,
  baseDir,
  disabled = false,
  error,
  compact = false,
  onChange,
  onCommit
}: Props): JSX.Element {
  const [draft, setDraft] = useState(value)
  const [dragOver, setDragOver] = useState(false)
  const [pathProbe, setPathProbe] = useState<'idle' | 'ok' | 'missing'>('idle')

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    let cancelled = false
    const t = draft.trim()
    if (!t || !canRevealUserMetadataLink(t, baseDir)) {
      setPathProbe('idle')
      return
    }
    const handle = window.setTimeout(() => {
      void (async () => {
        const r = await probeUserMetadataLinkPath(t, baseDir)
        if (cancelled) return
        setPathProbe(r === 'missing' ? 'missing' : r === 'ok' ? 'ok' : 'idle')
      })()
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [draft, baseDir])

  const canOpen = canFollowUserMetadataLink(draft, baseDir)
  const canReveal = canRevealUserMetadataLink(draft, baseDir)
  const btnClass = compact ? 'btn preview-user-meta-follow' : 'btn'
  const missing = pathProbe === 'missing'

  const applyPath = (absolute: string, preferRelative: boolean): void => {
    const next = formatUserMetadataLinkPath(absolute, baseDir, preferRelative)
    setDraft(next)
    onChange(next)
    onCommit?.(next.trim() || null)
  }

  const onBrowse = async (preferRelative: boolean): Promise<void> => {
    const picked = await pickUserMetadataLinkPath(baseDir, preferRelative)
    if (picked == null) return
    setDraft(picked)
    onChange(picked)
    onCommit?.(picked.trim() || null)
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (disabled) return
    const path = pathFromDataTransfer(e.dataTransfer)
    if (!path) return
    applyPath(path, e.shiftKey)
  }

  return (
    <div
      className={`user-meta-link-editor${compact ? ' is-compact' : ''}${canReveal ? ' has-reveal' : ''}${dragOver ? ' is-dragover' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) setDragOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) {
          e.dataTransfer.dropEffect = 'copy'
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <input
        id={id}
        type="text"
        spellCheck={false}
        placeholder="https://… or path — drop file (Shift = relative)"
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(e.target.value)
        }}
        onBlur={() => onCommit?.(draft.trim() || null)}
      />
      <button
        type="button"
        className={btnClass}
        disabled={disabled}
        title="Browse for a file or folder (Shift = store relative path)"
        onClick={(e) => {
          e.preventDefault()
          void onBrowse(e.shiftKey)
        }}
      >
        Browse…
      </button>
      <button
        type="button"
        className={btnClass}
        disabled={disabled || !canOpen}
        title="Open URL, folder, or file"
        onClick={(e) => {
          e.preventDefault()
          const next = draft.trim()
          if (next !== value.trim()) onCommit?.(next || null)
          void followUserMetadataLink(next, baseDir)
        }}
      >
        Open
      </button>
      {canReveal ? (
        <button
          type="button"
          className={btnClass}
          disabled={disabled}
          title="Show in this window"
          onClick={(e) => {
            e.preventDefault()
            const next = draft.trim()
            if (next !== value.trim()) onCommit?.(next || null)
            void revealUserMetadataLink(next, baseDir)
          }}
        >
          Reveal
        </button>
      ) : null}
      {missing ? (
        <span className="user-meta-link-missing" title="Path not found on disk">
          Path not found
        </span>
      ) : null}
      {error ? <span className="user-meta-link-error">{error}</span> : null}
    </div>
  )
}
