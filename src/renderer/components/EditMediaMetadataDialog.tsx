import { useEffect, useState, type JSX } from 'react'
import type { MediaMetadata, MediaMetadataEditFields } from '@shared/mediaMetadata'
import { parseMediaFileName, splitMediaMetadataList } from '@shared/mediaMetadata'
import { useAppStore } from '../store/appStore'
import { api, IpcError } from '../lib/ipc'
import { basename } from '../lib/paths'

function listToInput(values: string[] | undefined): string {
  return values?.join(', ') ?? ''
}

function optionalNumberInput(value: number | undefined): string {
  return value != null && Number.isFinite(value) ? String(value) : ''
}

function parseOptionalYear(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function parseOptionalInt(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.trunc(n)
}

function sourceLabel(source: MediaMetadata['source']): string {
  switch (source) {
    case 'plex':
      return 'Plex'
    case 'tmdb':
      return 'TMDB'
    case 'omdb':
      return 'OMDb'
    case 'manual':
      return 'Manual'
    default:
      return source
  }
}

export function EditMediaMetadataDialog({ path }: { path: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const mediaMetadataSave = useAppStore((s) => s.mediaMetadataSave)
  const notify = useAppStore((s) => s.notify)

  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [meta, setMeta] = useState<MediaMetadata | null>(null)
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const [language, setLanguage] = useState('')
  const [country, setCountry] = useState('')
  const [genres, setGenres] = useState('')
  const [directors, setDirectors] = useState('')
  const [actors, setActors] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [watched, setWatched] = useState(false)
  const [season, setSeason] = useState('')
  const [episode, setEpisode] = useState('')
  const [showTitle, setShowTitle] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await api.mediaMetadata.get({ path })
      if (cancelled) return
      if (res.ok && res.value.metadata) {
        const m = res.value.metadata
        setMeta(m)
        setTitle(m.title)
        setYear(optionalNumberInput(m.year))
        setLanguage(m.originalLanguage ?? '')
        setCountry(listToInput(m.country))
        setGenres(listToInput(m.genres))
        setDirectors(listToInput(m.directors))
        setActors(listToInput(m.actors))
        setSynopsis(m.synopsis ?? '')
        setWatched(m.watched === true)
        setSeason(optionalNumberInput(m.season))
        setEpisode(optionalNumberInput(m.episode))
        setShowTitle(m.showTitle ?? '')
      } else {
        setMeta(null)
        const parsed = parseMediaFileName(basename(path))
        setTitle(parsed.title || basename(path).replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').trim())
        setYear(optionalNumberInput(parsed.year))
        if (parsed.kind === 'episode') {
          setSeason(optionalNumberInput(parsed.season))
          setEpisode(optionalNumberInput(parsed.episode))
        }
      }
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  const isEpisode =
    meta?.kind === 'episode' ||
    (!meta && loaded && parseMediaFileName(basename(path)).kind === 'episode')

  const save = async (): Promise<void> => {
    const trimmed = title.trim()
    if (!trimmed) {
      notify('Title is required', true)
      return
    }
    setBusy(true)
    try {
      const fields: MediaMetadataEditFields = {
        title: trimmed,
        year: parseOptionalYear(year),
        originalLanguage: language.trim() || null,
        country: splitMediaMetadataList(country),
        genres: splitMediaMetadataList(genres),
        directors: splitMediaMetadataList(directors),
        actors: splitMediaMetadataList(actors),
        synopsis: synopsis.trim() || null,
        watched
      }
      if (isEpisode) {
        fields.season = parseOptionalInt(season)
        fields.episode = parseOptionalInt(episode)
        fields.showTitle = showTitle.trim() || null
      }
      await mediaMetadataSave(path, fields)
      closeDialog()
    } catch (e) {
      notify(e instanceof IpcError ? e.message : 'Could not save media metadata', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}
    >
      <div className="modal modal-edit-media-metadata" role="dialog" aria-label="Edit metadata">
        <div className="modal-title">Edit metadata</div>
        <div className="modal-body">
          <p className="dim item-note-path" title={path}>
            {basename(path)}
          </p>
          <p className="dim media-edit-hint">
            Updating from Plex/Internet can replace these fields; watched is kept.
          </p>
          <label className="item-note-field">
            <span>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!loaded || busy}
              autoFocus
              maxLength={500}
            />
          </label>
          <label className="item-note-field">
            <span>Year</span>
            <input
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              disabled={!loaded || busy}
              placeholder="Optional"
            />
          </label>
          {isEpisode ? (
            <>
              <div className="media-edit-row">
                <label className="item-note-field">
                  <span>Season</span>
                  <input
                    inputMode="numeric"
                    value={season}
                    onChange={(e) => setSeason(e.target.value)}
                    disabled={!loaded || busy}
                  />
                </label>
                <label className="item-note-field">
                  <span>Episode</span>
                  <input
                    inputMode="numeric"
                    value={episode}
                    onChange={(e) => setEpisode(e.target.value)}
                    disabled={!loaded || busy}
                  />
                </label>
              </div>
              <label className="item-note-field">
                <span>Show title</span>
                <input
                  value={showTitle}
                  onChange={(e) => setShowTitle(e.target.value)}
                  disabled={!loaded || busy}
                  maxLength={500}
                />
              </label>
            </>
          ) : null}
          <label className="item-note-field">
            <span>Language</span>
            <input
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={!loaded || busy}
              maxLength={80}
            />
          </label>
          <label className="item-note-field">
            <span>Country</span>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              disabled={!loaded || busy}
              placeholder="Comma-separated"
            />
          </label>
          <label className="item-note-field">
            <span>Genres</span>
            <input
              value={genres}
              onChange={(e) => setGenres(e.target.value)}
              disabled={!loaded || busy}
              placeholder="Comma-separated"
            />
          </label>
          <label className="item-note-field">
            <span>Directors</span>
            <input
              value={directors}
              onChange={(e) => setDirectors(e.target.value)}
              disabled={!loaded || busy}
              placeholder="Comma-separated"
            />
          </label>
          <label className="item-note-field">
            <span>Actors</span>
            <input
              value={actors}
              onChange={(e) => setActors(e.target.value)}
              disabled={!loaded || busy}
              placeholder="Comma-separated"
            />
          </label>
          <label className="item-note-field">
            <span>Synopsis</span>
            <textarea
              rows={5}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              disabled={!loaded || busy}
              maxLength={20_000}
            />
          </label>
          <label className="media-edit-watched">
            <input
              type="checkbox"
              checked={watched}
              onChange={(e) => setWatched(e.target.checked)}
              disabled={!loaded || busy}
            />
            <span>Watched</span>
          </label>
          {meta ? (
            <p className="dim media-edit-source">
              Source: {sourceLabel(meta.source)}
              {meta.sourceId ? ` · ${meta.sourceId}` : ''}
              {meta.kind ? ` · ${meta.kind}` : ''}
            </p>
          ) : loaded ? (
            <p className="dim media-edit-source">No card yet — saving creates a manual entry.</p>
          ) : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => closeDialog()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!loaded || busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
