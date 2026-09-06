import type { JSX } from 'react'
import {
  DEFAULT_ICON_TAG_NAME,
  iconTagOptionColor,
  parseIconTagsColumnValue,
  type UserMetadataField
} from '@shared/schemas/userMetadata'
import { normalizeIconPack } from '@shared/schemas/iconPack'
import { packIconElement } from '../lib/iconPacks'

export function UserMetadataIconTagsToggle({
  field,
  selectedIds,
  disabled,
  size = 18,
  onToggle
}: {
  field: UserMetadataField
  selectedIds: string[]
  disabled?: boolean
  size?: number
  onToggle(optionId: string): void
}): JSX.Element {
  const on = new Set(selectedIds)
  return (
    <div className="user-meta-icon-tags" role="group" aria-label={field.name}>
      {(field.choices ?? []).map((o) => {
        const active = on.has(o.id)
        const pack = normalizeIconPack(o.lucidePack)
        const name = o.lucideName?.trim() || DEFAULT_ICON_TAG_NAME
        const color = iconTagOptionColor(o)
        return (
          <button
            key={o.id}
            type="button"
            className={`user-meta-icon-tag${active ? ' is-on' : ' is-off'}`}
            aria-pressed={active}
            title={o.label}
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onToggle(o.id)
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {packIconElement(pack, name, { size, color, strokeWidth: 2 })}
          </button>
        )
      })}
    </div>
  )
}

/** Details cell: parse `mo_*:0|1` tokens and toggle via callback. */
export function UserMetadataIconTagsCell({
  field,
  columnRaw,
  disabled,
  onToggle
}: {
  field: UserMetadataField
  columnRaw: string
  disabled?: boolean
  onToggle(optionId: string): void
}): JSX.Element {
  const selectedIds = parseIconTagsColumnValue(columnRaw)
    .filter((x) => x.on)
    .map((x) => x.id)
  return (
    <UserMetadataIconTagsToggle
      field={field}
      selectedIds={selectedIds}
      disabled={disabled}
      size={15}
      onToggle={onToggle}
    />
  )
}
