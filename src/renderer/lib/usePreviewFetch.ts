import { useEffect, useState } from 'react'
import type { PreviewModel } from '@shared/schemas/preview'
import { api } from './ipc'
import { basename, samePath } from './paths'
import { isAudioExt, isVideoExt } from './icons'

let previewSeq = 0

function mergeAvTags(
  model: PreviewModel,
  meta: { fields: PreviewModel['fields']; subtitle?: string; coverUrl?: string }
): PreviewModel {
  const kept = model.fields.filter((f) => f.group !== 'video' && f.group !== 'audio')
  return {
    ...model,
    fields: [...kept, ...meta.fields],
    subtitle: meta.subtitle ?? model.subtitle,
    posterUrl: model.kind === 'audio' && meta.coverUrl ? meta.coverUrl : model.posterUrl,
    mediaMetaPending: false
  }
}

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

    // Start tag parse in parallel with preview:get. Do not paint the player until
    // both are ready — otherwise the VIDEO/AUDIO strip appears later and jumps the layout.
    const metaPromise = likelyAv ? api.preview.getMediaMeta({ path: previewPath }) : null

    void api.preview.get({ path: previewPath, ...adsArg }).then(async (res) => {
      if (seq !== previewSeq) return
      const next = res.ok ? res.value : null
      if (metaPromise && next?.mediaMetaPending && (next.kind === 'video' || next.kind === 'audio')) {
        const metaRes = await metaPromise
        if (seq !== previewSeq) return
        setLoading(false)
        if (metaRes.ok) {
          setModel(mergeAvTags(next, metaRes.value))
        } else {
          setModel({ ...next, mediaMetaPending: false })
        }
        return
      }
      setLoading(false)
      setModel(next)
    })
  }, [previewPath, selectedStamp, versionOverrideAds])

  const retryPlayableForce = (): void => {
    // Intentionally empty — Preview never ffmpeg-remuxes for playback.
  }

  return { model, loading, retryPlayableForce }
}
