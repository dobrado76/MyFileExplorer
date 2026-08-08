import { useEffect, useRef, useState, type JSX } from 'react'
import FilerobotImageEditor, { TABS, TOOLS } from 'react-filerobot-image-editor'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { basename } from '../lib/paths'
import { ImageRemoveOverlay } from './ImageRemoveOverlay'

/**
 * Full-window Filerobot host. Image bytes come from main via IPC.
 * Remove mode runs local LaMa ONNX inpainting, then remounts Filerobot.
 * In-place save preserves AppData `image-originals/` backup.
 */
export function ImageEditor(): JSX.Element | null {
  const editor = useAppStore((s) => s.imageEditor)
  const closeImageEditor = useAppStore((s) => s.closeImageEditor)
  const saveEditedImage = useAppStore((s) => s.saveEditedImage)
  const saveEditedImageAs = useAppStore((s) => s.saveEditedImageAs)
  const notify = useAppStore((s) => s.notify)

  const [src, setSrc] = useState<string | null>(null)
  const [srcKey, setSrcKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [removeMode, setRemoveMode] = useState(false)
  const [removeBusy, setRemoveBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const openRemoveRef = useRef<() => void>(() => undefined)
  openRemoveRef.current = () => setRemoveMode(true)

  useEffect(() => {
    if (!editor) {
      setSrc(null)
      setRemoveMode(false)
      return
    }
    let alive = true
    setSrc(null)
    setRemoveMode(false)
    void (async () => {
      try {
        const res = await call(api.fs.readImageForEdit({ path: editor.path }))
        if (!alive) return
        setSrc(`data:${res.mime};base64,${res.dataBase64}`)
        setSrcKey((k) => k + 1)
      } catch (e) {
        if (alive) {
          notify(e instanceof Error ? e.message : 'Could not load image for editing', true)
          closeImageEditor()
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [editor, notify, closeImageEditor])

  // Filename in topbar + Remove tab under Resize (same Filerobot tab chrome).
  useEffect(() => {
    if (!src || !editor || removeMode) return
    const name = basename(editor.path)
    const root = rootRef.current
    if (!root) return

    const place = (): void => {
      const wrap = root.querySelector('.FIE_topbar-buttons-wrapper')
      if (wrap) {
        let label = wrap.querySelector('.mfe-edit-filename') as HTMLSpanElement | null
        if (!label) {
          label = document.createElement('span')
          label.className = 'mfe-edit-filename'
          wrap.appendChild(label)
        }
        label.textContent = name
        label.title = name
      }

      const tabs = root.querySelector('.FIE_tabs_navbar')
      if (!tabs) return
      const resizeTab =
        (tabs.querySelector('[data-testid="FIE-tab-resize"]') as HTMLElement | null) ??
        (tabs.querySelector('.FIE_tab:last-of-type') as HTMLElement | null)
      if (!resizeTab) return

      let removeTab = tabs.querySelector('.mfe-remove-tab') as HTMLElement | null
      if (!removeTab) {
        removeTab = resizeTab.cloneNode(true) as HTMLElement
        removeTab.classList.add('mfe-remove-tab')
        removeTab.setAttribute('aria-selected', 'false')
        removeTab.setAttribute('data-testid', 'FIE-tab-remove')
        removeTab.setAttribute('title', 'Context-aware remove')
        removeTab.setAttribute('role', 'button')

        const oldSvg = removeTab.querySelector('svg')
        if (oldSvg) {
          oldSvg.outerHTML = REMOVE_TAB_ICON_SVG
        }

        const labelEl =
          (removeTab.querySelector('.FIE_tab-label') as HTMLElement | null) ??
          (removeTab.querySelector('[data-testid^="FIE-tab-item-label"]') as HTMLElement | null)
        if (labelEl) {
          labelEl.textContent = 'Remove'
          for (const span of labelEl.querySelectorAll('span')) {
            span.textContent = 'Remove'
          }
        }

        resizeTab.after(removeTab)
      }

      removeTab.onclick = (e) => {
        e.preventDefault()
        e.stopPropagation()
        openRemoveRef.current()
      }
    }

    place()
    const id = window.setInterval(place, 200)
    const stop = window.setTimeout(() => window.clearInterval(id), 4000)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(stop)
    }
  }, [src, editor, removeMode, srcKey])

  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (removeBusy || saving) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (removeMode) {
        setRemoveMode(false)
        return
      }
      closeImageEditor()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editor, saving, removeMode, removeBusy, closeImageEditor])

  const runSaveAs = async (dataBase64: string | undefined): Promise<void> => {
    if (!editor || !dataBase64) {
      notify('Editor returned no image data', true)
      return
    }
    setSaving(true)
    try {
      await saveEditedImageAs(editor.path, dataBase64)
    } catch {
      // notify already done in store
    } finally {
      setSaving(false)
    }
  }

  if (!editor) return null

  const name = basename(editor.path)

  return (
    <div
      ref={rootRef}
      className="image-editor"
      role="dialog"
      aria-label={`Edit ${name}`}
    >
      <div className="image-editor-body">
        {!src ? (
          <div className="image-editor-loading">Loading…</div>
        ) : removeMode ? (
          <ImageRemoveOverlay
            imageSrc={src}
            busy={removeBusy}
            onBusy={setRemoveBusy}
            onStatus={(msg) => notify(msg, false)}
            onError={(msg) => notify(msg, true)}
            onCancel={() => setRemoveMode(false)}
            onApplied={(dataUrl) => {
              setSrc(dataUrl)
              setSrcKey((k) => k + 1)
              setRemoveMode(false)
              notify('Remove applied — Save when ready', false)
            }}
          />
        ) : (
          <FilerobotImageEditor
            key={srcKey}
            source={src}
            tabsIds={[TABS.ADJUST, TABS.FINETUNE, TABS.FILTERS, TABS.ANNOTATE, TABS.RESIZE]}
            defaultTabId={TABS.ADJUST}
            defaultToolId={TOOLS.CROP}
            useAiTab={false}
            closeAfterSave
            avoidChangesNotSavedAlertOnLeave
            // Skip Filerobot’s own “save as” modal — Save overwrites in place via onSave.
            onBeforeSave={() => false}
            defaultSavedImageName={name.replace(/\.[^.]+$/, '') || name}
            defaultSavedImageType={extToSavedType(editor.path)}
            savingPixelRatio={Math.min(2, window.devicePixelRatio || 1)}
            previewPixelRatio={Math.min(2, window.devicePixelRatio || 1)}
            Crop={{
              // Free-form: corner moves two adjacent sides (patched in postinstall).
              ratio: 'custom',
              ratioTitleKey: 'custom',
              noPresets: true,
              autoResize: true
            }}
            moreSaveOptions={[
              {
                label: 'Save as…',
                icon: 'save',
                onClick: (_triggerModal, triggerSave) => {
                  // Direct save path so current crop/design is baked into imageBase64.
                  triggerSave(async (imageData: { imageBase64?: string }) => {
                    await runSaveAs(imageData.imageBase64)
                  })
                }
              }
            ]}
            theme={{
              palette: {
                'bg-primary': '#12141a',
                'bg-secondary': '#1a1d26',
                'accent-primary': '#3b82f6',
                'borders-secondary': '#2a2f3a',
                'text-primary': '#e8eaef',
                'text-secondary': '#9aa3b2'
              }
            }}
            onSave={async (imageData) => {
              const data = imageData.imageBase64
              if (!data) {
                notify('Editor returned no image data', true)
                return
              }
              setSaving(true)
              try {
                await saveEditedImage(editor.path, data)
              } catch {
                // notify already done in store
              } finally {
                setSaving(false)
              }
            }}
            onClose={() => {
              if (!saving) closeImageEditor()
            }}
          />
        )}
      </div>
    </div>
  )
}

/** Inline eraser icon matching Filerobot tab icon size (24). */
const REMOVE_TAB_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-testid="FIE-tab-item-icon-remove" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`

function extToSavedType(filePath: string): 'png' | 'jpeg' | 'jpg' | 'webp' {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'bmp') return 'jpeg'
  if (ext === 'webp') return 'webp'
  return 'png'
}
