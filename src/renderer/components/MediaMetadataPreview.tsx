import {
  createContext,
  useContext,
  useEffect,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Eye, EyeOff, ImageIcon, Pencil } from 'lucide-react'
import { formatEpisodeCode, formatMediaRating, type MediaMetadata } from '@shared/mediaMetadata'
import {
  classifyMediaRatingSource,
  formatMediaRatingCopyLine,
  formatMediaRatingScore,
  mediaRatingSourceTitle
} from '@shared/mediaRatings'
import { thumbPathKey } from '../lib/thumbMemory'
import { useAppStore } from '../store/appStore'
import { api } from '../lib/ipc'
import { CloseIcon, CopyIcon } from '../lib/icons'
import { MediaRatingIcon } from '../lib/mediaRatingIcons'

function thumbBlob(bytes: Uint8Array): Blob {
  let type = 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) type = 'image/png'
  else if (bytes[0] === 0x47 && bytes[1] === 0x49) type = 'image/gif'
  else if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42) type = 'image/webp'
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer as ArrayBuffer], { type })
}

type MediaMetaView = {
  path: string
  meta: MediaMetadata
  thumbUrl: string | null
}

const MediaMetaCtx = createContext<MediaMetaView | null>(null)

export function useMediaMetadata(): MediaMetaView | null {
  return useContext(MediaMetaCtx)
}

export function mediaMetadataHasDetails(meta: MediaMetadata): boolean {
  return Boolean(
    (meta.country && meta.country.length > 0) ||
      (meta.genres && meta.genres.length > 0) ||
      (meta.directors && meta.directors.length > 0) ||
      (meta.actors && meta.actors.length > 0) ||
      meta.ratings?.some((r) => formatMediaRating(r.value)) ||
      meta.originalLanguage ||
      meta.synopsis
  )
}

export function MediaMetadataProvider({
  path,
  children
}: {
  path: string
  children: ReactNode
}): JSX.Element {
  const enabled = useAppStore((s) => s.settings.mediaMetadata.enabled)
  const bump = useAppStore((s) => s.thumbRevByPath[thumbPathKey(path)] ?? 0)
  const [view, setView] = useState<MediaMetaView | null>(null)

  useEffect(() => {
    if (!enabled || !path) {
      setView(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    void api.mediaMetadata.get({ path }).then((res) => {
      if (cancelled) return
      if (!res.ok || !res.value.metadata) {
        setView(null)
        return
      }
      if (res.value.thumbnailBase64) {
        const bytes = Uint8Array.from(atob(res.value.thumbnailBase64), (c) => c.charCodeAt(0))
        objectUrl = URL.createObjectURL(thumbBlob(bytes))
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setView({ path, meta: res.value.metadata, thumbUrl: objectUrl })
      } else {
        setView({ path, meta: res.value.metadata, thumbUrl: null })
      }
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [enabled, path, bump])

  return <MediaMetaCtx.Provider value={view}>{children}</MediaMetaCtx.Provider>
}

function episodeLabel(meta: MediaMetadata): string | null {
  if (meta.kind !== 'episode') return null
  return formatEpisodeCode(meta.season, meta.episode)
}

export function MediaMetadataHero(): JSX.Element | null {
  const view = useContext(MediaMetaCtx)
  const coverHeightPx = useAppStore((s) => s.settings.mediaMetadata.coverHeightPx)
  const openDialog = useAppStore((s) => s.openDialog)
  const mediaMetadataSetWatched = useAppStore((s) => s.mediaMetadataSetWatched)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])
  if (!view) return null
  const { meta, thumbUrl } = view
  const ep = episodeLabel(meta)
  const sub = [meta.year, ep, meta.showTitle && meta.showTitle !== meta.title ? meta.showTitle : null]
    .filter(Boolean)
    .join(' · ')

  const coverW = Math.round((coverHeightPx * 2) / 3)
  const heroStyle = {
    '--mm-cover-h': `${coverHeightPx}px`,
    '--mm-cover-w': `${coverW}px`
  } as CSSProperties

  return (
    <div className="media-metadata-hero" style={heroStyle}>
      {thumbUrl ? (
        <button
          type="button"
          className="media-metadata-hero-poster is-clickable"
          onClick={() => setOpen(true)}
          title="View full cover"
          aria-label={`View full cover for ${meta.title}`}
        >
          <img src={thumbUrl} alt="" draggable={false} />
        </button>
      ) : (
        <div className="media-metadata-hero-poster" aria-hidden />
      )}
      <div className="media-metadata-hero-text">
        <div className="media-metadata-hero-title" title={meta.title}>
          {meta.title}
        </div>
        {sub ? <div className="media-metadata-hero-sub">{sub}</div> : null}
        <div className="media-metadata-hero-actions" role="toolbar" aria-label="Media actions">
          <button
            type="button"
            className="media-metadata-hero-action"
            title="Edit metadata…"
            aria-label="Edit metadata"
            onClick={() => openDialog({ kind: 'edit-media-metadata', path: view.path })}
          >
            <Pencil size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="media-metadata-hero-action"
            title="Change cover…"
            aria-label="Change cover"
            onClick={() => openDialog({ kind: 'change-cover', path: view.path })}
          >
            <ImageIcon size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="media-metadata-hero-action"
            title={view.meta.watched ? 'Mark as Unwatched' : 'Mark as Watched'}
            aria-label={view.meta.watched ? 'Mark as Unwatched' : 'Mark as Watched'}
            onClick={() => void mediaMetadataSetWatched([view.path], !view.meta.watched)}
          >
            {view.meta.watched ? (
              <EyeOff size={16} strokeWidth={2} aria-hidden />
            ) : (
              <Eye size={16} strokeWidth={2} aria-hidden />
            )}
          </button>
        </div>
      </div>
      {open && thumbUrl
        ? createPortal(
            <div
              className="media-metadata-cover-viewer"
              role="dialog"
              aria-modal="true"
              aria-label={`Cover: ${meta.title}`}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setOpen(false)
              }}
            >
              <header className="media-metadata-cover-viewer-bar">
                <div className="media-metadata-cover-viewer-title" title={meta.title}>
                  {meta.title}
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close"
                  title="Close (Esc)"
                  onClick={() => setOpen(false)}
                >
                  <CloseIcon />
                </button>
              </header>
              <div
                className="media-metadata-cover-viewer-stage"
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setOpen(false)
                }}
              >
                <img src={thumbUrl} alt={meta.title} draggable={false} />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

function BoxedField({
  label,
  value,
  onCopy,
  multiline = false
}: {
  label: string
  value: string
  onCopy?: (value: string) => Promise<void>
  multiline?: boolean
}): JSX.Element {
  return (
    <div className={`preview-field${multiline ? ' is-multiline' : ''}`}>
      <div className="field-label">
        <span className="field-label-text">{label}</span>
        {onCopy ? (
          <button
            type="button"
            className="field-copy"
            aria-label={`Copy ${label}`}
            onClick={() => void onCopy(value)}
          >
            <CopyIcon size={12} />
          </button>
        ) : null}
      </div>
      <div className="field-value">{value}</div>
    </div>
  )
}

export function MediaMetadataDetails({
  onCopy
}: {
  onCopy?: (value: string) => Promise<void>
} = {}): JSX.Element | null {
  const view = useContext(MediaMetaCtx)
  if (!view || !mediaMetadataHasDetails(view.meta)) return null
  const { meta } = view

  const ratingItems =
    meta.ratings
      ?.map((r) => {
        const brand = classifyMediaRatingSource(r.source)
        const score = formatMediaRatingScore(r, brand)
        if (!score) return null
        const title = mediaRatingSourceTitle(brand, r.source)
        return { brand, score, title, value: r.value, max: r.max }
      })
      .filter((x): x is NonNullable<typeof x> => x != null) ?? []
  const ratingsCopy = meta.ratings
    ?.map((r) => formatMediaRatingCopyLine(r))
    .filter((x): x is string => Boolean(x))
    .join('  ·  ')

  return (
    <div className="preview-fields preview-fields-media">
      <div>
        {meta.originalLanguage ? (
          <BoxedField label="Language" value={meta.originalLanguage} onCopy={onCopy} />
        ) : null}
        {meta.country?.length ? (
          <BoxedField label="Country" value={meta.country.join(', ')} onCopy={onCopy} />
        ) : null}
        {meta.genres?.length ? (
          <div className="preview-field preview-field-pills">
            <div className="field-label">
              <span className="field-label-text">Genres</span>
            </div>
            <div className="media-metadata-chips">
              {meta.genres.map((g) => (
                <span key={g} className="media-metadata-chip">
                  {g}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {meta.directors?.length ? (
          <BoxedField label="Directors" value={meta.directors.join(', ')} onCopy={onCopy} />
        ) : null}
        {meta.actors?.length ? (
          <BoxedField label="Actors" value={meta.actors.join(', ')} onCopy={onCopy} />
        ) : null}
        {ratingItems.length > 0 ? (
          <div className="preview-field preview-field-pills">
            <div className="field-label">
              <span className="field-label-text">Ratings</span>
              {onCopy && ratingsCopy ? (
                <button
                  type="button"
                  className="field-copy"
                  aria-label="Copy Ratings"
                  onClick={() => void onCopy(ratingsCopy)}
                >
                  <CopyIcon size={12} />
                </button>
              ) : null}
            </div>
            <div className="media-metadata-ratings">
              {ratingItems.map((r) => (
                <span
                  key={`${r.brand}-${r.title}-${r.score}`}
                  className="media-metadata-rating"
                  title={r.title}
                  aria-label={`${r.title} ${r.score}`}
                >
                  <MediaRatingIcon
                    brand={r.brand}
                    title={r.title}
                    size={16}
                    value={r.value}
                    max={r.max}
                  />
                  <span className="media-metadata-rating-score">{r.score}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {meta.synopsis ? (
          <BoxedField label="Synopsis" value={meta.synopsis} onCopy={onCopy} multiline />
        ) : null}
      </div>
    </div>
  )
}

/** Stacked hero + details when there is no video/player in between. */
export function MediaMetadataPreview(): JSX.Element | null {
  const view = useContext(MediaMetaCtx)
  if (!view) return null
  return (
    <>
      <MediaMetadataHero />
      <MediaMetadataDetails />
    </>
  )
}
