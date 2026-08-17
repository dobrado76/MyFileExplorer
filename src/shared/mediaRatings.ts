import { formatMediaRating, type MediaMetadataRating } from './mediaMetadata'

export type MediaRatingBrand =
  | 'imdb'
  | 'rt'
  | 'metacritic'
  | 'tmdb'
  | 'plex'
  | 'plex-audience'
  | 'other'

export function classifyMediaRatingSource(source: string): MediaRatingBrand {
  const s = source.trim().toLowerCase()
  if (!s) return 'other'
  if (s === 'plex audience' || s.endsWith(' audience')) return 'plex-audience'
  if (s === 'plex') return 'plex'
  if (s.includes('imdb') || s.includes('internet movie')) return 'imdb'
  if (s.includes('rotten')) return 'rt'
  if (s.includes('metacritic')) return 'metacritic'
  if (s.includes('tmdb') || s.includes('themoviedb') || s.includes('the movie database')) {
    return 'tmdb'
  }
  return 'other'
}

export function mediaRatingSourceTitle(
  brand: MediaRatingBrand,
  original: string
): string {
  switch (brand) {
    case 'imdb':
      return 'IMDb'
    case 'rt':
      return 'Rotten Tomatoes'
    case 'metacritic':
      return 'Metacritic'
    case 'tmdb':
      return 'TMDB'
    case 'plex':
      return 'Plex'
    case 'plex-audience':
      return 'Plex audience'
    default:
      return original.trim() || 'Rating'
  }
}

export function formatMediaRatingScore(
  rating: MediaMetadataRating,
  brand: MediaRatingBrand
): string {
  const n = formatMediaRating(rating.value)
  if (!n) return ''
  if (brand === 'rt' && (rating.max == null || rating.max === 100) && rating.value > 10) {
    return `${n}%`
  }
  if (rating.max) return `${n}/${rating.max}`
  return n
}

export function formatMediaRatingCopyLine(rating: MediaMetadataRating): string | null {
  const brand = classifyMediaRatingSource(rating.source)
  const score = formatMediaRatingScore(rating, brand)
  if (!score) return null
  return `${score} ${mediaRatingSourceTitle(brand, rating.source)}`
}
