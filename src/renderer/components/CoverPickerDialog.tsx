import { useEffect, useState, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { basename, samePath } from '../lib/paths'
import { CloseIcon } from '../lib/icons'

type Cover = {
  id: string
  source: 'plex' | 'tmdb' | 'current'
  label: string
  selected: boolean
  previewBase64: string
  width: number
  height: number
}

function sizeText(c: Cover): string {
  return c.width > 0 && c.height > 0 ? `${c.width}×${c.height}` : ''
}

function previewSrc(b64: string): string {
  return `data:image/jpeg;base64,${b64}`
}

function upsertCover(list: Cover[], next: Cover): Cover[] {
  const merged = list.some((c) => c.id === next.id)
    ? list.map((c) => (c.id === next.id ? next : c))
    : [...list, next]
  return merged.sort((a, b) => b.width * b.height - a.width * a.height)
}

export function CoverPickerDialog({ path }: { path: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const invalidateContentThumbs = useAppStore((s) => s.invalidateContentThumbs)
  const notify = useAppStore((s) => s.notify)
  const [title, setTitle] = useState(basename(path))
  const [covers, setCovers] = useState<Cover[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
    setLoading(true)
    setError(null)
    void call(api.mediaMetadata.listCovers({ path }))
      .then((res) => {
        if (cancelled) return
        setTitle(res.title)
        setCovers(res.covers)
        setPicked((cur) => cur ?? res.covers[0]?.id ?? null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    const unsub = api.onEvent((event) => {
      if (event.type !== 'cover-list') return
      if (!samePath(event.payload.path, path)) return
      if (cancelled) return
      if (event.payload.cover) {
        const cover = event.payload.cover
        setCovers((cur) => upsertCover(cur, cover))
        setPicked((cur) => cur ?? cover.id)
      }
      if (event.payload.done) setLoading(false)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [path])

  const apply = async (): Promise<void> => {
    if (!picked) return
    setSaving(true)
    setError(null)
    try {
      const previewBase64 = covers.find((c) => c.id === picked)?.previewBase64
      await call(api.mediaMetadata.setCover({ path, coverId: picked, previewBase64 }))
      invalidateContentThumbs([path])
      notify('Cover updated')
      closeDialog()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      notify(message, true)
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="modal modal-wide modal-cover-picker" role="dialog" aria-label="Change cover">
        <div className="modal-title modal-title-chrome">
          <span className="modal-title-text">Change cover — {title}</span>
          <button type="button" className="modal-title-btn" aria-label="Close" onClick={closeDialog}>
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="modal-body cover-picker-body">
          {error ? <p className="cover-picker-error">{error}</p> : null}
          {!loading && !error && covers.length === 0 ? (
            <p className="dim">No covers found. Extract from Plex or download from the internet first.</p>
          ) : null}
          <div className="cover-picker-grid">
            {covers.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`cover-picker-cell${picked === c.id ? ' is-selected' : ''}`}
                onClick={() => setPicked(c.id)}
                title={[c.label, sizeText(c), c.selected ? 'Current' : ''].filter(Boolean).join(' · ')}
              >
                <img src={previewSrc(c.previewBase64)} alt="" draggable={false} />
                <span className="cover-picker-label">
                  {c.label}
                  {c.selected ? ' · Current' : ''}
                </span>
                {sizeText(c) ? <span className="cover-picker-size">{sizeText(c)}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <span className="dim cover-picker-status">
            {loading
              ? covers.length > 0
                ? `Loading more… ${covers.length}`
                : 'Loading covers…'
              : covers.length > 0
                ? `${covers.length} cover${covers.length === 1 ? '' : 's'}`
                : ''}
          </span>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!picked || saving || covers.length === 0}
            onClick={() => void apply()}
          >
            {saving ? 'Saving…' : 'Use this cover'}
          </button>
        </div>
      </div>
    </div>
  )
}
