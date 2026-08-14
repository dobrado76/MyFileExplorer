import { useEffect, useRef, useState } from 'react'
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
  retryPlayableForce: () => void
} {
  const [model, setModel] = useState<PreviewModel | null>(null)
  const [loading, setLoading] = useState(false)
  const forcePlayableTried = useRef<string | null>(null)

  useEffect(() => {
    if (!previewPath) {
      setModel(null)
      setLoading(false)
      forcePlayableTried.current = null
      return
    }
    forcePlayableTried.current = null
    const seq = ++previewSeq
    setLoading(true)
    setModel((prev) => (prev && samePath(prev.path, previewPath) ? null : prev))
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
      if (next?.kind === 'video' && next.needsPlayable && !next.mediaUrl) {
        void api.preview.ensurePlayable({ path: previewPath }).then((play) => {
          if (seq !== previewSeq) return
          const mediaUrl = play.ok ? play.value.mediaUrl : null
          setModel((prev) =>
            prev && samePath(prev.path, previewPath)
              ? {
                  ...prev,
                  mediaUrl: mediaUrl ?? undefined,
                  needsPlayable: false,
                  warnings:
                    mediaUrl || !prev.posterUrl
                      ? prev.warnings
                      : [
                          ...(prev.warnings ?? []),
                          'In-app convert timed out or failed — open with the default app to watch'
                        ]
                }
              : prev
          )
        })
      }
      if (metaPromise && next?.mediaMetaPending) {
        void metaPromise.then(applyMediaMeta)
      } else if (next?.mediaMetaPending && (next.kind === 'video' || next.kind === 'audio')) {
        void api.preview.getMediaMeta({ path: previewPath }).then(applyMediaMeta)
      }
    })
  }, [previewPath, selectedStamp, versionOverrideAds])

  const retryPlayableForce = (): void => {
    if (!previewPath) return
    const path = previewPath
    if (forcePlayableTried.current && samePath(forcePlayableTried.current, path)) return
    forcePlayableTried.current = path
    setModel((prev) =>
      prev && samePath(prev.path, path)
        ? { ...prev, mediaUrl: undefined, needsPlayable: true }
        : prev
    )
    void api.preview.ensurePlayable({ path, force: true }).then((play) => {
      const mediaUrl = play.ok ? play.value.mediaUrl : null
      setModel((prev) => {
        if (!prev || !samePath(prev.path, path)) return prev
        return {
          ...prev,
          mediaUrl: mediaUrl ?? undefined,
          needsPlayable: false,
          warnings:
            mediaUrl || !prev.posterUrl
              ? prev.warnings
              : [
                  ...(prev.warnings ?? []),
                  'In-app convert timed out or failed — open with the default app to watch'
                ]
        }
      })
    })
  }

  return { model, loading, retryPlayableForce }
}
