import { useEffect, useMemo, useState, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { EditImageIcon, PopOutIcon } from '../lib/icons'
import { isEditableImagePath } from '@shared/imageEdit'
import { tryCaptionPosterUrl, decodeImageUrl } from '../lib/captionPoster'
import { usePreviewFetch } from '../lib/usePreviewFetch'
import { usePreviewTarget } from '../lib/usePreviewTarget'
import { PreviewView } from './preview/PreviewView'
import { ItemNotePreview } from './ItemNotePreview'
import { isVolumeRootPath } from '../lib/rightDrag'
import type { ItemNote } from '@shared/schemas/itemAds'
import { lookupGitForPath } from '../lib/gitUi'
import { samePath } from '../lib/paths'

export function PreviewPane(): JSX.Element {
  const notify = useAppStore((s) => s.notify)
  const openPath = useAppStore((s) => s.openPath)
  const openFileLocation = useAppStore((s) => s.openFileLocation)
  const openImageEditor = useAppStore((s) => s.openImageEditor)
  const extractZip = useAppStore((s) => s.extractZip)
  const mediaHold = useAppStore((s) => s.mediaHold)
  const previewWindowOpen = useAppStore((s) => s.previewWindowOpen)
  const previewVideoAutoplay = useAppStore((s) => s.settings.previewVideoAutoplay)
  const textWordWrap = useAppStore((s) => s.settings.previewTextWordWrap === true)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const setImageVersionPreview = useAppStore((s) => s.setImageVersionPreview)
  const dropImageVersion = useAppStore((s) => s.dropImageVersion)
  const drawCaption = useAppStore((s) => s.devGateActive && s.settings.slideshow.drawCaption)
  const gitEnabled = useAppStore((s) => s.settings.git?.enabled === true)
  const gitByRoot = useAppStore((s) => s.gitByRoot)
  const mergeGitStatus = useAppStore((s) => s.mergeGitStatus)
  const [captionPosterUrl, setCaptionPosterUrl] = useState<string | null>(null)
  const [itemNote, setItemNote] = useState<ItemNote | null>(null)
  const columnMetaBump = useAppStore((s) => s.columnMetaBump)

  const drives = useAppStore((s) => s.drives)
  const drivesOverview = useAppStore((s) => s.drivesOverview)
  const listingPath = useAppStore((s) => s.listing.path)
  const { previewPath, selectedStamp, versionOverrideAds, selected } = usePreviewTarget()
  const driveSpace = useMemo(
    () =>
      drivesOverview
        ? { drives, focusPath: null as string | null }
        : selected.length <= 1 && previewPath && isVolumeRootPath(previewPath)
          ? { drives, focusPath: previewPath }
          : selected.length === 0 && isVolumeRootPath(listingPath)
            ? { drives, focusPath: listingPath }
            : null,
    [drives, drivesOverview, listingPath, previewPath, selected.length]
  )

  const gitLookup =
    gitEnabled && previewPath && !driveSpace
      ? lookupGitForPath(gitByRoot, previewPath)
      : null
  const gitRepo =
    gitLookup && samePath(gitLookup.rootPath, previewPath!)
      ? {
          repoRoot: gitLookup.rootPath,
          status: gitLookup.status,
          onRefreshStatus: () => {
            void (async () => {
              try {
                const res = await call(api.git.refresh({ repoRoot: gitLookup.rootPath }))
                mergeGitStatus(res.status)
              } catch {
                /* ignore */
              }
            })()
          }
        }
      : null

  useEffect(() => {
    if (!gitEnabled || !previewPath || driveSpace) return
    let cancelled = false
    void (async () => {
      try {
        const res = await call(api.git.getStatus({ path: previewPath }))
        if (cancelled || !res.inRepo || !res.status) return
        mergeGitStatus(res.status)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gitEnabled, previewPath, driveSpace, mergeGitStatus])

  const { model, loading, retryPlayableForce } = usePreviewFetch(
    previewPath,
    versionOverrideAds,
    selectedStamp
  )

  const [versionMeta, setVersionMeta] = useState<{ count: number } | null>(null)
  useEffect(() => {
    if (!previewPath || !isEditableImagePath(previewPath)) {
      setVersionMeta(null)
      return
    }
    let cancelled = false
    void api.fs.imageEditState({ path: previewPath }).then((res) => {
      if (cancelled) return
      if (res.ok && res.value.versionCount >= 1) {
        setVersionMeta({ count: res.value.versionCount })
      } else {
        setVersionMeta(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [previewPath, selectedStamp])

  useEffect(() => {
    if (!drawCaption || !previewPath || model?.kind !== 'image' || !model.mediaUrl) {
      if (!drawCaption || !previewPath) setCaptionPosterUrl(null)
      return
    }
    const photoUrl = model.mediaUrl
    let cancelled = false
    void (async () => {
      try {
        const img = await decodeImageUrl(photoUrl)
        if (!img || cancelled) return
        const url = await tryCaptionPosterUrl(previewPath, img)
        if (!cancelled) setCaptionPosterUrl(url)
      } catch {
        if (!cancelled) setCaptionPosterUrl(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [drawCaption, previewPath, selectedStamp, model?.kind, model?.mediaUrl])

  useEffect(() => {
    if (!previewPath) {
      setItemNote(null)
      return
    }
    let cancelled = false
    void api.itemAds.getMany({ paths: [previewPath] }).then((res) => {
      if (cancelled) return
      setItemNote(res.ok ? (res.value[previewPath]?.note ?? null) : null)
    })
    return () => {
      cancelled = true
    }
  }, [previewPath, selectedStamp, columnMetaBump.rev, columnMetaBump.path])

  const versionBanner =
    versionOverrideAds !== undefined && versionMeta ? (
      <div className="preview-version-banner">
        <span>
          {versionOverrideAds === null
            ? 'Viewing original'
            : (() => {
                const m = /^VER_(\d+)$/i.exec(versionOverrideAds)
                const k = m ? Number(m[1]) : null
                return k != null
                  ? `Viewing Version ${k} of ${versionMeta.count}`
                  : `Viewing ${versionOverrideAds}`
              })()}
        </span>
        <div className="preview-version-banner-actions">
          {(() => {
            const m =
              typeof versionOverrideAds === 'string'
                ? /^VER_(\d+)$/i.exec(versionOverrideAds)
                : null
            const dropVer = m ? Number(m[1]) : null
            if (dropVer == null || !previewPath) return null
            return (
              <button
                type="button"
                className="btn preview-version-banner-btn"
                title={`Permanently remove Version ${dropVer}. Remaining versions are renumbered. The pristine original is kept until you Commit or Revert.`}
                onClick={() => void dropImageVersion(previewPath, dropVer)}
              >
                Drop
              </button>
            )
          })()}
          <button
            type="button"
            className="btn preview-version-banner-btn"
            title="Clear this preview override and show the current tip edit (or the file if there is no history)."
            onClick={() => setImageVersionPreview(null)}
          >
            Show current
          </button>
        </div>
      </div>
    ) : null

  return (
    <PreviewView
      model={model}
      loading={loading}
      previewPath={previewPath}
      driveSpace={driveSpace}
      gitRepo={gitRepo}
      multiCount={selected.length}
      mediaHold={mediaHold}
      previewWindowOpen={previewWindowOpen}
      previewVideoAutoplay={previewVideoAutoplay}
      captionPosterUrl={captionPosterUrl}
      textWordWrap={textWordWrap}
      onToggleTextWordWrap={() => void applySettingsPatch({ previewTextWordWrap: !textWordWrap })}
      banner={versionBanner}
      onOpenPath={(path) => void openPath(path)}
      onRevealPath={(path) => void openFileLocation(path)}
      onExtractZip={(paths) => void extractZip(paths)}
      onNotify={notify}
      onRetryPlayableForce={retryPlayableForce}
      extraBeforeFields={itemNote ? <ItemNotePreview note={itemNote} /> : null}
      headerActions={
        <>
          {model?.kind === 'image' &&
            model.mediaUrl &&
            !captionPosterUrl &&
            isEditableImagePath(model.path) && (
              <button
                type="button"
                className="icon-btn preview-edit-btn"
                aria-label="Edit image"
                title="Edit image (Ctrl+E)"
                onClick={() => openImageEditor(model.path, model.mediaUrl!)}
              >
                <EditImageIcon size={16} />
              </button>
            )}
          <button
            type="button"
            className="icon-btn preview-popout-btn"
            aria-label="Open preview window"
            title="Open preview window"
            onClick={() => void api.preview.openWindow()}
          >
            <PopOutIcon size={16} />
          </button>
        </>
      }
    />
  )
}
