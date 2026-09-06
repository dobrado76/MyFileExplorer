import type { MediaMetadata, MediaMetadataKind } from './mediaMetadata'
import { isSeasonFolderName } from './mediaMetadata'
import type { MediaAskAiQueryId } from './schemas/aiChat'

export type MediaAskAiKind = 'movie' | 'show' | 'season' | 'episode'

export type MediaAskAiCard = {
  kind: MediaAskAiKind
  title: string
  year?: number
  season?: number
  episode?: number
  showTitle?: string
  genres?: string[]
}

export type MediaAskAiMenuItem = {
  queryId: MediaAskAiQueryId
  label: string
  title: string
}

/** Resolve Ask AI kind from stored metadata + folder name heuristics. */
export function resolveMediaAskAiKind(opts: {
  isDirectory: boolean
  folderOrFileName: string
  meta: Pick<MediaMetadata, 'kind' | 'title' | 'season' | 'episode' | 'showTitle'> | null
}): MediaAskAiKind | null {
  const meta = opts.meta
  if (!meta?.title?.trim() && !(meta?.kind === 'episode' && meta.showTitle?.trim())) {
    return null
  }
  if (opts.isDirectory && isSeasonFolderName(opts.folderOrFileName)) return 'season'
  if (meta?.kind === 'episode') return 'episode'
  if (meta?.kind === 'show') return 'show'
  if (meta?.kind === 'movie') return 'movie'
  if (opts.isDirectory) return 'show'
  return 'movie'
}

export function mediaAskAiCardFromMeta(
  kind: MediaAskAiKind,
  meta: MediaMetadata,
  folderOrFileName: string
): MediaAskAiCard {
  const title =
    kind === 'episode'
      ? meta.title?.trim() || `Episode ${meta.episode ?? '?'}`.trim()
      : meta.title?.trim() || folderOrFileName
  return {
    kind,
    title,
    year: meta.year,
    season: meta.season,
    episode: meta.episode,
    showTitle: meta.showTitle,
    genres: meta.genres
  }
}

export function mediaAskAiMenuItems(kind: MediaAskAiKind): MediaAskAiMenuItem[] {
  switch (kind) {
    case 'movie':
      return [
        {
          queryId: 'summary-safe',
          label: 'Summary (no spoilers)',
          title: 'Ask AI for a spoiler-free movie summary'
        },
        {
          queryId: 'summary-spoilers',
          label: 'Summary (full spoilers)',
          title: 'Ask AI for a full movie summary including spoilers'
        },
        {
          queryId: 'list-safe',
          label: 'Related movies / franchise (no spoilers)',
          title: 'Ask AI to list related or franchise films with short spoiler-free blurbs'
        },
        {
          queryId: 'list-spoilers',
          label: 'Related movies / franchise (full spoilers)',
          title: 'Ask AI to list related or franchise films with full spoilers'
        }
      ]
    case 'show':
      return [
        {
          queryId: 'summary-safe',
          label: 'Show summary (no spoilers)',
          title: 'Ask AI for a spoiler-free series overview'
        },
        {
          queryId: 'summary-spoilers',
          label: 'Show summary (full spoilers)',
          title: 'Ask AI for a full series overview including spoilers'
        },
        {
          queryId: 'list-safe',
          label: 'List seasons (no spoilers)',
          title: 'Ask AI to list seasons with a short spoiler-free summary each'
        },
        {
          queryId: 'list-spoilers',
          label: 'List seasons (full spoilers)',
          title: 'Ask AI to list seasons with full spoilers each'
        }
      ]
    case 'season':
      return [
        {
          queryId: 'summary-safe',
          label: 'Season summary (no spoilers)',
          title: 'Ask AI for a spoiler-free season overview'
        },
        {
          queryId: 'summary-spoilers',
          label: 'Season summary (full spoilers)',
          title: 'Ask AI for a full season overview including spoilers'
        },
        {
          queryId: 'list-safe',
          label: 'List episodes (no spoilers)',
          title: 'Ask AI to list episodes in this season with spoiler-free blurbs'
        },
        {
          queryId: 'list-spoilers',
          label: 'List episodes (full spoilers)',
          title: 'Ask AI to list episodes in this season with full spoilers'
        }
      ]
    case 'episode':
      return [
        {
          queryId: 'summary-safe',
          label: 'Episode summary (no spoilers)',
          title: 'Ask AI for a spoiler-free episode summary'
        },
        {
          queryId: 'summary-spoilers',
          label: 'Episode summary (full spoilers)',
          title: 'Ask AI for a full episode summary including spoilers'
        },
        {
          queryId: 'list-safe',
          label: 'How it fits the show (no spoilers)',
          title: 'Ask AI how this episode fits the season/show without spoilers'
        },
        {
          queryId: 'list-spoilers',
          label: 'How it fits the show (full spoilers)',
          title: 'Ask AI how this episode fits the season/show with full spoilers'
        }
      ]
  }
}

function cardIdentityBlock(card: MediaAskAiCard): string {
  const bits: string[] = []
  if (card.kind === 'episode' && card.showTitle) {
    bits.push(`Show: ${card.showTitle}`)
  }
  bits.push(`Title: ${card.title}`)
  if (card.year != null) bits.push(`Year: ${card.year}`)
  bits.push(`Kind: ${card.kind}`)
  if (card.season != null) bits.push(`Season: ${card.season}`)
  if (card.episode != null) bits.push(`Episode: ${card.episode}`)
  if (card.genres?.length) bits.push(`Genres: ${card.genres.join(', ')}`)
  return bits.join('\n')
}

function spoilerRule(fullSpoilers: boolean): string {
  return fullSpoilers
    ? 'You may include full spoilers. Say so briefly at the top.'
    : 'Do NOT include spoilers. Avoid plot twists, endings, deaths, and major reveals.'
}

export function mediaAskAiKindDetail(kind: MediaAskAiKind): string {
  switch (kind) {
    case 'movie':
      return 'Movie'
    case 'show':
      return 'Show'
    case 'season':
      return 'Season'
    case 'episode':
      return 'Episode'
  }
}

/** UI strip under the conversation title — identity only, never a path. */
export function mediaAskAiSourceContext(card: MediaAskAiCard): {
  feature: 'media'
  title: string
  detail: string
  glyph: 'media'
} {
  const title =
    card.kind === 'episode' && card.showTitle
      ? card.season != null && card.episode != null
        ? `${card.showTitle} · S${String(card.season).padStart(2, '0')}E${String(card.episode).padStart(2, '0')} · ${card.title}`
        : `${card.showTitle} · ${card.title}`
      : card.year != null
        ? `${card.title} (${card.year})`
        : card.title
  return {
    feature: 'media',
    title: title.slice(0, 200),
    detail: mediaAskAiKindDetail(card.kind),
    glyph: 'media'
  }
}

export function buildMediaAskAiSystemPrompt(
  queryId: MediaAskAiQueryId,
  kind: MediaAskAiKind,
  card: MediaAskAiCard
): string {
  const spoilers = queryId.endsWith('spoilers')
  return [
    'You are a helpful movie and TV guide inside a desktop file manager.',
    'Reply in clear Markdown (headings, short paragraphs, bullet lists when useful).',
    'Do not ask for file paths or local files.',
    'Media identity below was supplied by the app (not typed by the user). Treat it as the subject of the conversation.',
    spoilerRule(spoilers),
    `Focus on this media kind: ${kind}.`,
    '',
    'Media identity:',
    cardIdentityBlock(card)
  ].join('\n')
}

/** User-visible / stored user turn — the question only (no metadata dump). */
export function buildMediaAskAiUserPrompt(
  card: MediaAskAiCard,
  queryId: MediaAskAiQueryId
): string {
  const spoilers = queryId.endsWith('spoilers')
  const list = queryId.startsWith('list')

  if (!list) {
    if (card.kind === 'episode') {
      return `Write a ${spoilers ? 'full' : 'spoiler-free'} summary of this episode.`
    }
    if (card.kind === 'season') {
      return `Write a ${spoilers ? 'full' : 'spoiler-free'} summary of this season.`
    }
    if (card.kind === 'show') {
      return `Write a ${spoilers ? 'full' : 'spoiler-free'} overview of this TV show.`
    }
    return `Write a ${spoilers ? 'full' : 'spoiler-free'} summary of this movie.`
  }
  if (card.kind === 'movie') {
    return `List related movies and/or franchise entries with a short blurb each (${
      spoilers ? 'full spoilers OK' : 'no spoilers'
    }).`
  }
  if (card.kind === 'show') {
    return `List the seasons with a short summary for each (${
      spoilers ? 'full spoilers OK' : 'no spoilers'
    }).`
  }
  if (card.kind === 'season') {
    return `List the episodes in this season with a short summary for each (${
      spoilers ? 'full spoilers OK' : 'no spoilers'
    }).`
  }
  return `Explain how this episode fits into the season/show (${
    spoilers ? 'full spoilers OK' : 'no spoilers'
  }).`
}

export function mediaAskAiConversationTitle(card: MediaAskAiCard): string {
  if (card.kind === 'episode' && card.showTitle) {
    const ep =
      card.season != null && card.episode != null
        ? ` S${String(card.season).padStart(2, '0')}E${String(card.episode).padStart(2, '0')}`
        : ''
    return `${card.showTitle}${ep}`.slice(0, 200)
  }
  return (card.year != null ? `${card.title} (${card.year})` : card.title).slice(0, 200)
}

/** @deprecated type alias for callers that still say MediaMetadataKind */
export type { MediaMetadataKind }
