import { useMemo, type JSX } from 'react'
import type { UserMetadataField } from '@shared/schemas/userMetadata'
import { booleanFieldLabels } from '@shared/schemas/userMetadata'
import { resolveMetadataSet } from '@shared/userMetadataBindings'
import { useAppStore } from '../store/appStore'
import { samePath } from '../lib/paths'
import { userMetadataFacetsActive } from '../lib/userMetadataFacets'

const FACET_TYPES = new Set(['boolean', 'choice', 'iconTags', 'multiChoice'])

function facetFields(fields: UserMetadataField[]): UserMetadataField[] {
  return fields.filter((f) => FACET_TYPES.has(f.type))
}

export function UserMetadataFacetToolbar(): JSX.Element | null {
  const enabled = useAppStore((s) => s.settings.userMetadata?.enabled === true)
  const um = useAppStore((s) => s.settings.userMetadata)
  const listingPath = useAppStore((s) => s.listing.path)
  const session = useAppStore((s) => s.userMetadataSession)
  const setFacet = useAppStore((s) => s.setUserMetadataFacet)
  const clearFacets = useAppStore((s) => s.clearUserMetadataFacets)

  const set = useMemo(() => {
    if (!enabled || !listingPath || !um) return null
    return resolveMetadataSet(listingPath, um)
  }, [enabled, listingPath, um])

  const fields = useMemo(() => (set ? facetFields(set.fields) : []), [set])
  const facets =
    session.folderPath && listingPath && samePath(session.folderPath, listingPath)
      ? session.facets
      : {}
  const active = userMetadataFacetsActive(facets)

  if (!enabled || !set || fields.length === 0) return null

  return (
    <div className="toolbar-edit" role="group" aria-label="Metadata facets">
      <span className="toolbar-sep" aria-hidden />
      {fields.map((field) => {
        const selected = facets[field.id] ?? []
        if (field.type === 'boolean') {
          const labels = booleanFieldLabels(field)
          const value =
            selected.length === 1 ? selected[0]! : selected.length > 1 ? '__multi__' : ''
          return (
            <label key={field.id} className="toolbar-media-label" htmlFor={`um-facet-${field.id}`}>
              <span className="toolbar-media-caption">{field.name}</span>
              <select
                id={`um-facet-${field.id}`}
                className="toolbar-remote-select toolbar-media-select"
                value={value === '__multi__' ? '' : value}
                onChange={(e) => {
                  const v = e.target.value
                  setFacet(field.id, v ? [v] : [])
                }}
                aria-label={`Filter ${field.name}`}
              >
                <option value="">All</option>
                <option value="true">{labels.trueLabel}</option>
                <option value="false">{labels.falseLabel}</option>
              </select>
            </label>
          )
        }
        // choice / iconTags / multiChoice — multi-select via checkbox menu is heavy;
        // use a single select for choice; multi/iconTags allow picking one option (any-of).
        return (
          <label key={field.id} className="toolbar-media-label" htmlFor={`um-facet-${field.id}`}>
            <span className="toolbar-media-caption">{field.name}</span>
            <select
              id={`um-facet-${field.id}`}
              className="toolbar-remote-select toolbar-media-select"
              value={selected[0] ?? ''}
              onChange={(e) => {
                const v = e.target.value
                setFacet(field.id, v ? [v] : [])
              }}
              aria-label={`Filter ${field.name}`}
            >
              <option value="">All</option>
              {(field.choices ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )
      })}
      {active && (
        <button type="button" className="btn btn-tiny" onClick={() => clearFacets()}>
          Clear facets
        </button>
      )}
    </div>
  )
}
