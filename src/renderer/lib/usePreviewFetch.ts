import { useEffect, useState } from 'react'
import type { PreviewModel } from '@shared/schemas/preview'
import { api } from './ipc'
import { basename, samePath } from './paths'
import { isAudioExt, isVideoExt } from './icons'

let previewSeq = 0

export function usePreviewFetch(
  previewPath: string | null,
  versionOverrideAds: string | null | undefined,
  selectedStamp: string | null
): {
  model: PreviewModel | null
  loading: boolean
  /** No-op kept for PreviewView prop compatibility. */
  retryPlayableForce: () => void
} {
  const [model, setModel] = useState<PreviewModel | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!previewPath) {
      setModel(null)
      setLoading(false)
      return
    }
    const seq = ++previewSeq
    setLoading(true)
    // Keep the current card while refetching the same path (e.g. live Space Usage patch)
    // so the map does not flash away.
    setModel((prev) => (prev && samePath(prev.path, previewPath) ? prev : null))
    const adsArg = versionOverrideAds === undefined ? {} : { ads: versionOverrideAds }

    const base = basename(previewPath)
    const dot = base.lastIndexOf('.')
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
    const likelyAv = isVideoExt(ext) || isAudioExt(ext)

    const metaPromise = likelyAv ? api.preview.getMediaMeta({ path: previewPath }) : null

    const applyMediaMeta = (
      metaRes: Awaited<ReturnType<typeof api.preview.getMediaMeta>>
    ): void => {
      if (seq !== previewSeq || !metaRes.ok) return
      const meta = metaRes.value
      setModel((prev) => {
        if (!prev || !samePath(prev.path, previewPath)) return prev
        if (prev.kind !== 'video' && prev.kind !== 'audio') return prev
        const kept = prev.fields.filter((f) => f.group !== 'video' && f.group !== 'audio')
        return {
          ...prev,
          fields: [...kept, ...meta.fields],
          subtitle: meta.subtitle ?? prev.subtitle,
          posterUrl: prev.kind === 'audio' && meta.coverUrl ? meta.coverUrl : prev.posterUrl,
          mediaMetaPending: false
        }
      })
    }

    void api.preview.get({ path: previewPath, ...adsArg }).then((res) => {
      if (seq !== previewSeq) return
      setLoading(false)
      const next = res.ok ? res.value : null
      setModel(next)
      if (metaPromise && next?.mediaMetaPending) {
        void metaPromise.then(applyMediaMeta)
      } else if (next?.mediaMetaPending && (next.kind === 'video' || next.kind === 'audio')) {
        void api.preview.getMediaMeta({ path: previewPath }).then(applyMediaMeta)
      }
    })
  }, [previewPath, selectedStamp, versionOverrideAds])

  const retryPlayableForce = (): void => {
    // Intentionally empty — Preview never ffmpeg-remuxes for playback.
  }

  return { model, loading, retryPlayableForce }
}
