import { Component, useEffect, useMemo, useState, type ErrorInfo, type JSX, type ReactNode } from 'react'
import type { PreviewWindowTarget } from '@shared/schemas/preview'
import type { Settings } from '@shared/schemas/settings'
import type { DriveInfo } from '@shared/schemas/fs'
import { isVolumeRootPath } from '@shared/paths'
import { basename, samePath } from '../lib/paths'
import { api, call } from '../lib/ipc'
import { CompressIcon, DockIcon, ExpandIcon, SpinnerIcon } from '../lib/icons'
import { usePreviewFetch } from '../lib/usePreviewFetch'
import { lookupGitForPath } from '../lib/gitUi'
import { useAppStore } from '../store/appStore'
import { PreviewView } from './preview/PreviewView'
import { ItemNotePreview } from './ItemNotePreview'
import { UserMetadataPreview } from './UserMetadataPreview'
import { EditMediaMetadataDialog } from './EditMediaMetadataDialog'
import { CoverPickerDialog } from './CoverPickerDialog'
import type { ItemNote } from '@shared/schemas/itemAds'

class PreviewErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    console.error('preview window render failed', err, info.componentStack)
  }

  override componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <div className="preview-empty">Preview failed. Select another file.</div>
    }
    return this.props.children
  }
}

function applyChromeSettings(settings: Settings): void {
  const rootEl = document.documentElement
  rootEl.dataset['theme'] = settings.theme === 'custom' ? 'dark' : settings.theme
  const custom = settings.theme === 'custom' ? settings.customTheme : null
  const vars: Record<string, string | null> = {
    '--bg': custom?.bg ?? null,
    '--bg-elevated': custom?.bgElevated ?? null,
    '--bg-panel': custom?.bg ?? null,
    '--border': custom?.border ?? null,
    '--text': custom?.text ?? null,
    '--text-dim': custom?.textDim ?? null,
    '--accent': custom?.accent ?? null
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v) rootEl.style.setProperty(k, v)
    else rootEl.style.removeProperty(k)
  }
  rootEl.style.setProperty('--font-family', `'${settings.fontFamily}', system-ui, sans-serif`)
  rootEl.style.setProperty('--font-size', `${settings.fontSizePx}px`)
  rootEl.style.setProperty('--icon-size', `${settings.iconSizePx}px`)
}

function PreviewWindowDialogs(): JSX.Element | null {
  const dialog = useAppStore((s) => s.dialog)
  if (!dialog) return null
  if (dialog.kind === 'edit-media-metadata') return <EditMediaMetadataDialog path={dialog.path} />
  if (dialog.kind === 'change-cover') return <CoverPickerDialog path={dialog.path} />
  return null
}

function PreviewWindowNotice(): JSX.Element | null {
  const notice = useAppStore((s) => s.notice)
  if (!notice) return null
  return (
    <div className={`preview-window-notice${notice.isError ? ' is-error' : ''}`} role="status">
      {notice.text}
    </div>
  )
}

/**
 * Detached preview window. Owns its own `preview:get` — do not call `app.ready()`
 * (that drains CLI/protocol opens meant for the main shell).
 */
export function PreviewWindowApp(): JSX.Element {
  const [target, setTarget] = useState<PreviewWindowTarget>({ path: null })
  const [autoplay, setAutoplay] = useState(false)
  const [richPlayer, setRichPlayer] = useState(false)
  const [zen, setZen] = useState(false)
  const [textWordWrap, setTextWordWrap] = useState(false)
  const [itemNote, setItemNote] = useState<ItemNote | null>(null)
  const [userMetadataEnabled, setUserMetadataEnabled] = useState(false)
  const [gitEnabled, setGitEnabled] = useState(false)
  const [drives, setDrives] = useState<DriveInfo[]>([])
  const [booted, setBooted] = useState(false)
  const gitByRoot = useAppStore((s) => s.gitByRoot)
  const mergeGitStatus = useAppStore((s) => s.mergeGitStatus)
  const notify = useAppStore((s) => s.notify)

  useEffect(() => {
    const load = (): void => {
      void call(api.settings.get())
        .then((s) => {
          applyChromeSettings(s)
          useAppStore.setState({ settings: s })
          setAutoplay(s.previewVideoAutoplay)
          setRichPlayer(s.previewRichPlayerMpv === true)
          setZen(s.previewWindowZen === true)
          setTextWordWrap(s.previewTextWordWrap === true)
          setUserMetadataEnabled(s.userMetadata?.enabled === true)
          setGitEnabled(s.git?.enabled === true)
          setBooted(true)
        })
        .catch(() => {
          document.documentElement.dataset['theme'] = 'dark'
          setBooted(true)
        })
    }
    load()
    void call(api.fs.listDrives())
      .then((r) => setDrives(r.drives))
      .catch(() => {})
    const onFocus = (): void => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const toggleZen = (): void => {
    const next = !zen
    setZen(next)
    void api.settings.set({ previewWindowZen: next })
  }

  const toggleWordWrap = (): void => {
    const next = !textWordWrap
    setTextWordWrap(next)
    void api.settings.set({ previewTextWordWrap: next })
  }

  useEffect(() => {
    let cancelled = false
    void api.preview.getTarget().then((res) => {
      if (!cancelled && res.ok) setTarget(res.value)
    })
    const unsub = api.onEvent((event) => {
      if (event.type === 'preview-target') setTarget(event.payload)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  const { model, loading, retryPlayableForce } = usePreviewFetch(
    target.path,
    target.ads,
    target.stamp ?? null
  )

  useEffect(() => {
    document.title = target.path ? basename(target.path) : 'Preview'
  }, [target.path])

  useEffect(() => {
    const p = target.path
    if (!p) {
      setItemNote(null)
      return
    }
    let cancelled = false
    void api.itemAds.getMany({ paths: [p] }).then((res) => {
      if (cancelled) return
      setItemNote(res.ok ? (res.value[p]?.note ?? null) : null)
    })
    return () => {
      cancelled = true
    }
  }, [target.path, target.stamp])

  useEffect(() => {
    if (!gitEnabled || !target.path) return
    let cancelled = false
    void (async () => {
      try {
        const res = await call(api.git.getStatus({ path: target.path! }))
        if (cancelled || !res.inRepo || !res.status) return
        mergeGitStatus(res.status)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gitEnabled, target.path, mergeGitStatus])

  const driveSpace = useMemo(
    () =>
      target.path && isVolumeRootPath(target.path) && drives.length > 0
        ? { drives, focusPath: target.path }
        : null,
    [drives, target.path]
  )

  const gitLookup =
    gitEnabled && target.path && !driveSpace ? lookupGitForPath(gitByRoot, target.path) : null
  const gitRepo =
    gitLookup && samePath(gitLookup.rootPath, target.path!)
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

  const resetKey = `${target.path ?? ''}|${target.ads ?? ''}|${target.stamp ?? ''}`

  if (!booted) {
    return (
      <div className="preview">
        <div className="preview-empty">
          <SpinnerIcon size={20} className="spin" />
        </div>
      </div>
    )
  }

  return (
    <>
      <PreviewErrorBoundary resetKey={resetKey}>
        <PreviewView
          model={model}
          loading={loading}
          previewPath={target.path}
          driveSpace={driveSpace}
          gitRepo={gitRepo}
          detached
          previewVideoAutoplay={autoplay}
          previewRichPlayerMpv={richPlayer}
          zen={zen}
          textWordWrap={textWordWrap}
          onToggleTextWordWrap={toggleWordWrap}
          headerActions={
            <>
              <button
                type="button"
                className="icon-btn preview-dock-btn"
                aria-label="Dock preview"
                title="Dock preview"
                onClick={() => void api.preview.closeWindow()}
              >
                <DockIcon size={16} />
              </button>
              <button
                type="button"
                className={`icon-btn preview-zen-btn${zen ? ' active' : ''}`}
                aria-label={zen ? 'Exit Zen mode' : 'Zen mode'}
                aria-pressed={zen}
                title={zen ? 'Exit Zen mode' : 'Zen mode — hide details'}
                onClick={toggleZen}
              >
                {zen ? <CompressIcon size={16} /> : <ExpandIcon size={16} />}
              </button>
            </>
          }
          onOpenPath={(path) => void api.shell.openPath({ path })}
          onRevealPath={(path) => void api.shell.showItemInFolder({ path })}
          onExtractZip={(paths) => void api.fs.extractZip({ paths })}
          onNotify={notify}
          onRetryPlayableForce={retryPlayableForce}
          extraBeforeFields={
            itemNote || userMetadataEnabled ? (
              <>
                {itemNote ? <ItemNotePreview note={itemNote} /> : null}
                {userMetadataEnabled ? (
                  <UserMetadataPreview
                    path={target.path}
                    isDirectory={model ? model.kind === 'directory' : undefined}
                  />
                ) : null}
              </>
            ) : null
          }
        />
      </PreviewErrorBoundary>
      <PreviewWindowDialogs />
      <PreviewWindowNotice />
    </>
  )
}
