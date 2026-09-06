import type { JSX } from 'react'
import {
  classifyMediaRatingSource,
  formatMediaRatingScore,
  mediaRatingSourceTitle
} from '@shared/mediaRatings'
import { parseMediaRatingsColumnValue } from '@shared/mediaMetadata'
import { MediaRatingIcon } from '../lib/mediaRatingIcons'

/** Details-column ratings: same brand icons + scores as Preview. */
export function MediaMetadataRatingsCell({ raw }: { raw: string }): JSX.Element | null {
  const ratings = parseMediaRatingsColumnValue(raw)
  const items = ratings
    .map((r) => {
      const brand = classifyMediaRatingSource(r.source)
      const score = formatMediaRatingScore(r, brand)
      if (!score) return null
      const title = mediaRatingSourceTitle(brand, r.source)
      return { brand, score, title, value: r.value, max: r.max }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
  if (items.length === 0) return null
  return (
    <span className="media-metadata-ratings details-media-ratings">
      {items.map((r) => (
        <span
          key={`${r.brand}-${r.title}-${r.score}`}
          className="media-metadata-rating"
          title={r.title}
          aria-label={`${r.title} ${r.score}`}
        >
          <MediaRatingIcon
            brand={r.brand}
            title={r.title}
            size={14}
            value={r.value}
            max={r.max}
          />
          <span className="media-metadata-rating-score">{r.score}</span>
        </span>
      ))}
    </span>
  )
}

export function MediaMetadataGenresCell({ text }: { text: string }): JSX.Element | null {
  const genres = text
    .split(';')
    .map((g) => g.trim())
    .filter(Boolean)
  if (genres.length === 0) return null
  return (
    <span className="media-metadata-chips details-media-genres">
      {genres.map((g) => (
        <span key={g} className="media-metadata-chip">
          {g}
        </span>
      ))}
    </span>
  )
}
