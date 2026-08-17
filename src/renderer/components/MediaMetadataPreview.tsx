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
import { formatMediaRating, type MediaMetadata } from '@shared/mediaMetadata'
import { useAppStore } from '../store/appStore'
import { api } from '../lib/ipc'
import { CloseIcon } from '../lib/icons'

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

export function MediaMetadataProvider({
  path,
  children
}: {
  path: string
  children: ReactNode
}): JSX.Element {
  const enabled = useAppStore((s) => s.settings.mediaMetadata.enabled)
  const bump = useAppStore((s) => s.thumbRevByPath[path.toLowerCase()] ?? 0)
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
  if (meta.kind !== 'episode' || (meta.season == null && meta.episode == null)) return null
  return `S${String(meta.season ?? 0).padStart(2, '0')}E${String(meta.episode ?? 0).padStart(2, '0')}`
}

export function MediaMetadataHero(): JSX.Element | null {
  const view = useContext(MediaMetaCtx)
  const coverHeightPx = useAppStore((s) => s.settings.mediaMetadata.coverHeightPx)
  const openDialog = useAppStore((s) => s.openDialog)
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
        <button
          type="button"
          className="media-metadata-change-cover"
          onClick={() => openDialog({ kind: 'change-cover', path: view.path })}
        >
          Change cover
        </button>
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

function DetailRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="media-metadata-row">
      <div className="media-metadata-row-label">{label}</div>
      <div className="media-metadata-row-value">{children}</div>
    </div>
  )
}

export function MediaMetadataDetails(): JSX.Element | null {
  const view = useContext(MediaMetaCtx)
  if (!view) return null
  const { meta } = view
  const chips = (items: string[] | undefined): JSX.Element | null => {
    if (!items?.length) return null
    return (
      <div className="media-metadata-chips">
        {items.map((g) => (
          <span key={g} className="media-metadata-chip">
            {g}
          </span>
        ))}
      </div>
    )
  }

  const ratings = meta.ratings
    ?.map((r) => {
      const n = formatMediaRating(r.value)
      if (!n) return null
      return `${n}${r.max ? `/${r.max}` : ''} (${r.source})`
    })
    .filter(Boolean)
    .join('  ·  ')

  const hasBody =
    (meta.country && meta.country.length > 0) ||
    (meta.genres && meta.genres.length > 0) ||
    (meta.directors && meta.directors.length > 0) ||
    (meta.actors && meta.actors.length > 0) ||
    ratings ||
    meta.originalLanguage ||
    meta.synopsis

  if (!hasBody) return null

  return (
    <div className="media-metadata-details">
      {meta.originalLanguage ? (
        <DetailRow label="Language">{meta.originalLanguage}</DetailRow>
      ) : null}
      {meta.country?.length ? <DetailRow label="Country">{meta.country.join(', ')}</DetailRow> : null}
      {meta.genres?.length ? <DetailRow label="Genres">{chips(meta.genres)}</DetailRow> : null}
      {meta.directors?.length ? (
        <DetailRow label="Directors">{meta.directors.join(', ')}</DetailRow>
      ) : null}
      {meta.actors?.length ? <DetailRow label="Actors">{meta.actors.join(', ')}</DetailRow> : null}
      {ratings ? <DetailRow label="Ratings">{ratings}</DetailRow> : null}
      {meta.synopsis ? <p className="media-metadata-synopsis">{meta.synopsis}</p> : null}
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
