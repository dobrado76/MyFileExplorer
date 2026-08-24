import type { JSX } from 'react'
import type { ItemNote } from '@shared/schemas/itemAds'

export function ItemNotePreview({ note }: { note: ItemNote }): JSX.Element | null {
  const text = note.text.trim()
  const status = note.status?.trim()
  const checks = note.checklist?.filter((c) => c.text.trim()) ?? []
  if (!text && !status && checks.length === 0) return null
  return (
    <div className="preview-item-note">
      <div className="preview-item-note-title">Note</div>
      {status ? <div className="preview-item-note-status">{status}</div> : null}
      {text ? <div className="preview-item-note-text">{text}</div> : null}
      {checks.length > 0 ? (
        <ul className="preview-item-note-check">
          {checks.map((c, i) => (
            <li key={i} className={c.done ? 'done' : undefined}>
              {c.done ? '☑' : '☐'} {c.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
