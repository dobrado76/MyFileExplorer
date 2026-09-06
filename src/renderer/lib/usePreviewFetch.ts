import { useEffect, useState } from 'react'
import type { PreviewModel } from '@shared/schemas/preview'
import { api } from './ipc'
import { basename, samePath } from './paths'
import { isAudioExt, isVideoExt } from './icons'

let previewSeq = 0

/** Prefer painting with tags if they are already back; never block the pane on a hung parse. */
const TAG_WAIT_MS = 400

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

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = window.setTimeout(() => resolve(null), ms)
    void promise.then(
      (v) => {
        window.clearTimeout(t)
        resolve(v)
      },
      () => {
        window.clearTimeout(t)
        resolve(null)
      }
    )
  })
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

    const metaPromise = likelyAv ? api.preview.getMediaMeta({ path: previewPath }) : null

    const applyMediaMeta = (
      metaRes: Awaited<ReturnType<typeof api.preview.getMediaMeta>>
    ): void => {
      if (seq !== previewSeq || !metaRes.ok) return
      setModel((prev) => {
        if (!prev || !samePath(prev.path, previewPath)) return prev
        if (prev.kind !== 'video' && prev.kind !== 'audio') return prev
        return mergeAvTags(prev, metaRes.value)
      })
    }

    void api.preview
      .get({ path: previewPath, ...adsArg })
      .then(async (res) => {
        if (seq !== previewSeq) return
        const next = res.ok ? res.value : null
        const wantTags =
          Boolean(metaPromise) &&
          next?.mediaMetaPending === true &&
          (next.kind === 'video' || next.kind === 'audio')

        if (wantTags && metaPromise) {
          const raced = await raceTimeout(metaPromise, TAG_WAIT_MS)
          if (seq !== previewSeq) return
          setLoading(false)
          if (raced?.ok) setModel(mergeAvTags(next, raced.value))
          else setModel(next)
          // Hung / late / failed parse must not keep the spinner. Apply if it ever returns.
          void metaPromise.then(applyMediaMeta, () => undefined)
          return
        }

        setLoading(false)
        setModel(next)
        if (metaPromise && next?.mediaMetaPending && (next.kind === 'video' || next.kind === 'audio')) {
          void metaPromise.then(applyMediaMeta, () => undefined)
        }
      })
      .catch(() => {
        if (seq !== previewSeq) return
        setLoading(false)
        setModel(null)
      })
  }, [previewPath, selectedStamp, versionOverrideAds])

  const retryPlayableForce = (): void => {
    // Intentionally empty — Preview never ffmpeg-remuxes for playback.
  }

  return { model, loading, retryPlayableForce }
}
