import type { JSX, MouseEvent } from 'react'
import { Download, Eye, EyeOff, ImageIcon, Pencil } from 'lucide-react'
import type { DirEntry } from '@shared/schemas/fs'
import { isMediaMetadataVideoName, preferredMediaDownloadSource } from '@shared/mediaMetadata'
import { useAppStore } from '../store/appStore'

type Props = {
  entry: DirEntry
  watched: boolean | undefined
}

function stop(e: MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
}

/** Hover toolbar on media-container icon tiles (edit / download / cover / watched). */
export function MediaCardHoverActions({ entry, watched }: Props): JSX.Element | null {
  const mm = useAppStore((s) => s.settings.mediaMetadata)
  const openDialog = useAppStore((s) => s.openDialog)
  const mediaMetadataDownload = useAppStore((s) => s.mediaMetadataDownload)
  const mediaMetadataExtractPlex = useAppStore((s) => s.mediaMetadataExtractPlex)
  const mediaMetadataSetWatched = useAppStore((s) => s.mediaMetadataSetWatched)

  const eligible =
    entry.kind === 'dir' || (entry.kind === 'file' && isMediaMetadataVideoName(entry.name))
  if (!eligible) return null

  const downloadSource = preferredMediaDownloadSource(mm)
  const isWatched = watched === true

  return (
    <div className="media-card-hover-actions" role="toolbar" aria-label="Media actions">
      {downloadSource ? (
        <button
          type="button"
          className="media-card-hover-btn"
          title={
            downloadSource === 'internet'
              ? 'Download metadata from the Internet'
              : 'Extract metadata from Plex Media Server'
          }
          aria-label="Download metadata"
          onPointerDown={stop}
          onMouseDown={stop}
          onClick={(e) => {
            stop(e)
            if (downloadSource === 'internet') void mediaMetadataDownload([entry.path])
            else void mediaMetadataExtractPlex([entry.path])
          }}
        >
          <Download size={16} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        className="media-card-hover-btn"
        title="Edit metadata…"
        aria-label="Edit metadata"
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => {
          stop(e)
          openDialog({ kind: 'edit-media-metadata', path: entry.path })
        }}
      >
        <Pencil size={16} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className="media-card-hover-btn"
        title="Change cover…"
        aria-label="Change cover"
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => {
          stop(e)
          openDialog({ kind: 'change-cover', path: entry.path })
        }}
      >
        <ImageIcon size={16} strokeWidth={2} aria-hidden />
      </button>
      <button
        type="button"
        className="media-card-hover-btn"
        title={isWatched ? 'Mark as Unwatched' : 'Mark as Watched'}
        aria-label={isWatched ? 'Mark as Unwatched' : 'Mark as Watched'}
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => {
          stop(e)
          void mediaMetadataSetWatched([entry.path], !isWatched)
        }}
      >
        {isWatched ? (
          <EyeOff size={16} strokeWidth={2} aria-hidden />
        ) : (
          <Eye size={16} strokeWidth={2} aria-hidden />
        )}
      </button>
    </div>
  )
}
