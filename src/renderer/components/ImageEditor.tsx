import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import FilerobotImageEditor, {
  TABS,
  TOOLS,
  type getCurrentImgDataFunction
} from 'react-filerobot-image-editor'

type CropToolId = typeof TOOLS.CROP
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { basename } from '../lib/paths'
import { ImageRemoveOverlay } from './ImageRemoveOverlay'
import {
  annotationEditorClaimsKey,
  editorShortcutSupersedesTyping,
  imageEditShouldWrite,
  imageEditorShortcut
} from './imageEditorShortcuts'

/** Filerobot's in-canvas annotation text box. It is mounted without being focused. */
const ANNOTATION_TEXT_EDITOR_ID = 'FIE_text-content-editor'

function annotationTextEditor(): HTMLElement | null {
  const el = document.getElementById(ANNOTATION_TEXT_EDITOR_ID)
  return el instanceof HTMLElement ? el : null
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return Boolean(target.closest('[contenteditable="true"]'))
}

function focusAnnotationTextEditor(): void {
  const el = annotationTextEditor()
  if (!el?.isConnected) return
  if (el === document.activeElement || el.contains(document.activeElement)) return
  if (isTypingTarget(document.activeElement)) return
  el.focus()
}

function placeCaretInAnnotation(el: HTMLElement): void {
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** Insert the key that arrived before the text box had focus. */
function typeIntoAnnotationEditor(el: HTMLElement, e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false
  const command = e.key === 'Backspace' ? 'delete' : e.key === 'Delete' ? 'forwardDelete' : null
  const lineBreak = e.key === 'Enter' && e.shiftKey
  const text = !lineBreak && e.key.length === 1 ? e.key : null
  if (!command && !lineBreak && text == null) return false
  el.focus()
  placeCaretInAnnotation(el)
  if (command) document.execCommand(command)
  else if (lineBreak) document.execCommand('insertLineBreak')
  else if (text != null) document.execCommand('insertText', false, text)
  return true
}

function forwardAnnotationKey(el: HTMLElement, e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
  el.focus()
  el.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: e.key,
      bubbles: true,
      cancelable: true,
      shiftKey: e.shiftKey
    })
  )
}

/**
 * Full-window Filerobot host. Image bytes come from main via IPC once;
 * subsequent ops stay in memory until Save.
 * Remove mode runs local LaMa ONNX inpainting, then remounts Filerobot.
 * Before Crop / Remove, bake the current design into a new in-memory source
 * and remount so ops chain without Save → re-open (Filerobot Crop forces live
 * rotation to 0 — upstream #267 — and drops other in-session design).
 * Save writes tip ADS (`VER_n`); `$DATA` stays the pristine original (D27).
 */
export function ImageEditor(): JSX.Element | null {
  const editor = useAppStore((s) => s.imageEditor)
  const closeImageEditor = useAppStore((s) => s.closeImageEditor)
  const saveEditedImage = useAppStore((s) => s.saveEditedImage)
  const saveEditedImageAs = useAppStore((s) => s.saveEditedImageAs)
  const notify = useAppStore((s) => s.notify)

  const [src, setSrc] = useState<string | null>(null)
  const [srcKey, setSrcKey] = useState(0)
  const [defaultToolId, setDefaultToolId] = useState<CropToolId>(TOOLS.CROP)
  const [saving, setSaving] = useState(false)
  const [removeMode, setRemoveMode] = useState(false)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [baking, setBaking] = useState(false)
  const [versionCount, setVersionCount] = useState(0)
  const [undoConfirm, setUndoConfirm] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const getCurrentImgDataFnRef = useRef<getCurrentImgDataFunction | null>(null)
  const dirtyRef = useRef(false)
  /** True after a crop/remove was flattened into the working image. */
  const bakedFromDiskRef = useRef(false)
  const bakingRef = useRef(false)
  const editorRef = useRef(editor)
  const savingRef = useRef(false)
  const srcRef = useRef<string | null>(null)
  const removeModeRef = useRef(false)
  const removeBusyRef = useRef(false)
  const saveAsCurrentRef = useRef<() => void>(() => undefined)
  const readCurrentEditBase64Ref = useRef<() => string | null>(() => null)
  const undoLastRef = useRef<() => void>(() => undefined)
  const versionCountRef = useRef(0)
  const undoConfirmRef = useRef(false)
  const saveEditedImageRef = useRef(saveEditedImage)
  versionCountRef.current = versionCount
  undoConfirmRef.current = undoConfirm

  useEffect(() => {
    editorRef.current = editor
    saveEditedImageRef.current = saveEditedImage
    srcRef.current = src
    removeModeRef.current = removeMode
    removeBusyRef.current = removeBusy
  }, [editor, saveEditedImage, src, removeMode, removeBusy])

  const fileName = editor ? basename(editor.path) : ''

  useEffect(() => {
    if (!editor) {
      setSrc(null)
      setRemoveMode(false)
      setVersionCount(0)
      setUndoConfirm(false)
      dirtyRef.current = false
      bakedFromDiskRef.current = false
      return
    }
    let alive = true
    setSrc(null)
    setRemoveMode(false)
    setVersionCount(0)
    setUndoConfirm(false)
    dirtyRef.current = false
    bakedFromDiskRef.current = false
    setDefaultToolId(TOOLS.CROP)
    void (async () => {
      try {
        const [res, versions] = await Promise.all([
          call(api.fs.readImageForEdit({ path: editor.path })),
          call(api.fs.imageEditState({ path: editor.path })).catch(() => null)
        ])
        if (!alive) return
        setVersionCount(versions?.versionCount ?? 0)
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

  const bakeWorkingSource = useCallback((nextToolId?: CropToolId): boolean => {
    if (bakingRef.current) return false
    const fn = getCurrentImgDataFnRef.current
    if (typeof fn !== 'function' || !dirtyRef.current) {
      if (nextToolId) setDefaultToolId(nextToolId)
      return false
    }
    bakingRef.current = true
    setBaking(true)
    try {
      const savedType = fileName ? extToSavedType(fileName) : 'png'
      const extension = savedType === 'jpg' ? 'jpeg' : savedType
      const { imageData, hideLoadingSpinner } = fn(
        {
          name: 'edit',
          extension,
          quality: extension === 'jpeg' || extension === 'webp' ? 0.95 : undefined
        },
        false,
        true
      )
      try {
        hideLoadingSpinner?.()
      } catch {
        /* ignore */
      }
      const raw = imageData?.imageBase64
      if (!raw) return false
      const dataUrl = raw.startsWith('data:')
        ? raw
        : `data:${imageData.mimeType ?? `image/${extension}`};base64,${raw}`
      dirtyRef.current = false
      bakedFromDiskRef.current = true
      if (nextToolId) setDefaultToolId(nextToolId)
      setSrc(dataUrl)
      setSrcKey((k) => k + 1)
      return true
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not apply edit in memory', true)
      return false
    } finally {
      bakingRef.current = false
      setBaking(false)
    }
  }, [fileName, notify])

  const openRemoveRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    openRemoveRef.current = () => {
      bakeWorkingSource()
      setRemoveMode(true)
    }
  }, [bakeWorkingSource])

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

        const saveBtn = wrap.querySelector('[data-testid="FIE-save-button"]')
        if (saveBtn) saveBtn.setAttribute('title', 'Save (E or Ctrl+S)')

        let saveAs = wrap.querySelector('.mfe-save-as-btn') as HTMLButtonElement | null
        if (!saveAs) {
          saveAs = document.createElement('button')
          saveAs.type = 'button'
          saveAs.className = 'mfe-save-as-btn'
          saveAs.textContent = 'Save as…'
          const anchor =
            wrap.querySelector('.FIE_buttons-save-btn-wrapper') ??
            wrap.querySelector('.FIE_buttons-save-btn')
          if (anchor) anchor.after(saveAs)
          else wrap.appendChild(saveAs)
        }
        saveAs.title = 'Save the current edit as a new file (same folder by default)'
        saveAs.disabled = savingRef.current
        saveAs.onclick = (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          saveAsCurrentRef.current()
        }

        let undoBtn = wrap.querySelector('.mfe-undo-last-btn') as HTMLButtonElement | null
        if (versionCountRef.current < 1) {
          undoBtn?.remove()
        } else {
          if (!undoBtn) {
            undoBtn = document.createElement('button')
            undoBtn.type = 'button'
            undoBtn.className = 'mfe-undo-last-btn'
            undoBtn.textContent = 'Undo last'
            const anchor =
              wrap.querySelector('.mfe-save-as-btn') ??
              wrap.querySelector('.FIE_buttons-save-btn-wrapper') ??
              wrap.querySelector('.FIE_buttons-save-btn')
            if (anchor) anchor.after(undoBtn)
            else wrap.appendChild(undoBtn)
          }
          const n = versionCountRef.current
          undoBtn.textContent = n > 1 ? `Undo last (${n})` : 'Undo last'
          undoBtn.title =
            'Drop the newest saved version and open the previous one. The original file stays.'
          undoBtn.disabled = savingRef.current
          undoBtn.onclick = (ev) => {
            ev.preventDefault()
            ev.stopPropagation()
            undoLastRef.current()
          }
        }
      }

      const shortcutTitles: Array<[string, string]> = [
        ['FIE-tools-bar-item-button-crop', 'Crop (C)'],
        ['FIE-tools-bar-item-button-rotate', 'Rotate (R)'],
        ['FIE-tools-bar-item-button-flip_x', 'Flip X (F)'],
        ['FIE-tools-bar-item-button-flip_y', 'Flip Y (Shift+F)'],
        ['FIE-tab-resize', 'Resize (Z)'],
        ['FIE-tab-annotate', 'Annotate (A)'],
        ['FIE-tab-filters', 'Filters (T)'],
        ['FIE-tab-finetune', 'Finetune (U)']
      ]
      for (const [testId, title] of shortcutTitles) {
        root.querySelector(`[data-testid="${testId}"]`)?.setAttribute('title', title)
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
        removeTab.setAttribute('title', 'Remove (O)')
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
  }, [src, editor, removeMode, srcKey, versionCount])

  // Bake in-memory design before Crop so chained edits survive (upstream #267).
  useEffect(() => {
    const root = rootRef.current
    if (!root || !src || removeMode) return

    const onPointerDownCapture = (e: PointerEvent): void => {
      if (!dirtyRef.current || bakingRef.current) return
      const el = e.target as Element | null
      if (!el?.closest) return
      const cropBtn = el.closest('[data-testid="FIE-tools-bar-item-button-crop"]')
      if (!cropBtn) return
      e.preventDefault()
      e.stopPropagation()
      bakeWorkingSource(TOOLS.CROP)
    }

    root.addEventListener('pointerdown', onPointerDownCapture, true)
    return () => root.removeEventListener('pointerdown', onPointerDownCapture, true)
  }, [src, srcKey, removeMode, bakeWorkingSource])

  const activateAdjustTool = useCallback(
    (root: HTMLElement, toolTestId: string, bakeCrop: boolean): void => {
      if (bakeCrop && dirtyRef.current) {
        bakeWorkingSource(TOOLS.CROP)
        return
      }
      const clickTool = (): boolean => {
        const btn = root.querySelector(`[data-testid="${toolTestId}"]`) as HTMLElement | null
        if (!btn) return false
        btn.click()
        return true
      }
      if (clickTool()) return
      ;(root.querySelector('[data-testid="FIE-tab-adjust"]') as HTMLElement | null)?.click()
      let attempt = 0
      const retry = (): void => {
        if (clickTool() || attempt >= 8) return
        attempt += 1
        requestAnimationFrame(retry)
      }
      requestAnimationFrame(retry)
    },
    [bakeWorkingSource]
  )

  useEffect(() => {
    if (!editor) return
    const root = rootRef.current
    if (!root) return
    let raf = 0
    const focusText = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => focusAnnotationTextEditor())
    }
    const obs = new MutationObserver(focusText)
    obs.observe(root, { childList: true, subtree: true })
    const onFocusIn = (e: FocusEvent): void => {
      const text = annotationTextEditor()
      if (!text) return
      const target = e.target
      if (!(target instanceof Node) || text === target || text.contains(target)) return
      if (isTypingTarget(target)) return
      if (!(target instanceof Element)) return
      const stolen = target.closest('.konvajs-content') != null || target.tagName === 'CANVAS'
      if (!stolen) return
      text.focus()
    }
    window.addEventListener('focusin', onFocusIn)
    return () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
      window.removeEventListener('focusin', onFocusIn)
    }
  }, [editor, src])

  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent): void => {
      const textEditor = annotationTextEditor()
      const targetIsEditor =
        textEditor != null && (e.target === textEditor || textEditor.contains(e.target as Node))
      const targetIsTyping = isTypingTarget(e.target)
      const typing = targetIsTyping || targetIsEditor
      if (
        textEditor &&
        annotationEditorClaimsKey({
          editorOpen: true,
          targetIsEditor,
          targetIsTyping
        })
      ) {
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
          forwardAnnotationKey(textEditor, e)
          return
        }
        if (typeIntoAnnotationEditor(textEditor, e)) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        const pending = imageEditorShortcut(e)
        if (!pending || !editorShortcutSupersedesTyping(pending, e)) {
          textEditor.focus()
          e.preventDefault()
          e.stopPropagation()
          return
        }
      }
      if (e.key === 'Escape') {
        if (undoConfirmRef.current || useAppStore.getState().dialog) return
        if (removeBusy || saving || baking) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        if (removeMode) {
          e.preventDefault()
          setRemoveMode(false)
          return
        }
        // Escape leaves the text box; Filerobot handles that. A second Escape closes.
        if (typing || textEditor) return
        e.preventDefault()
        closeImageEditor()
        return
      }

      const action = imageEditorShortcut(e)
      if (!action) return
      // Letter keys type into resize fields and the annotation text box.
      // Ctrl/Cmd-S still saves from a field.
      if ((typing || textEditor) && !editorShortcutSupersedesTyping(action, e)) return
      e.preventDefault()
      e.stopPropagation()
      if (removeBusy || savingRef.current || bakingRef.current) return

      if (action === 'save') {
        const btn = rootRef.current?.querySelector(
          '[data-testid="FIE-save-button"]'
        ) as HTMLElement | null
        if (btn) {
          btn.click()
          return
        }
        const data = readCurrentEditBase64Ref.current()
        const ed = editorRef.current
        if (!data || !ed) return
        if (!imageEditShouldWrite({ hasUndo: dirtyRef.current, bakedFromDisk: bakedFromDiskRef.current })) {
          closeImageEditor()
          return
        }
        savingRef.current = true
        setSaving(true)
        void saveEditedImageRef
          .current(ed.path, data)
          .catch(() => undefined)
          .finally(() => {
            savingRef.current = false
            setSaving(false)
          })
        return
      }

      if (removeMode) return
      const root = rootRef.current
      if (!root) return
      if (action === 'remove') {
        openRemoveRef.current()
        return
      }
      if (action === 'crop') {
        activateAdjustTool(root, 'FIE-tools-bar-item-button-crop', true)
        return
      }
      if (action === 'rotate') {
        activateAdjustTool(root, 'FIE-tools-bar-item-button-rotate', false)
        return
      }
      if (action === 'flip-x') {
        activateAdjustTool(root, 'FIE-tools-bar-item-button-flip_x', false)
        return
      }
      if (action === 'flip-y') {
        activateAdjustTool(root, 'FIE-tools-bar-item-button-flip_y', false)
        return
      }
      const tabId =
        action === 'resize'
          ? 'FIE-tab-resize'
          : action === 'annotate'
            ? 'FIE-tab-annotate'
            : action === 'filters'
              ? 'FIE-tab-filters'
              : 'FIE-tab-finetune'
      ;(root.querySelector(`[data-testid="${tabId}"]`) as HTMLElement | null)?.click()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editor, saving, baking, removeMode, removeBusy, closeImageEditor, activateAdjustTool])

  const runSaveAs = useCallback(
    async (dataBase64: string | undefined): Promise<void> => {
      const ed = editorRef.current
      if (!ed || !dataBase64) {
        notify('Editor returned no image data', true)
        return
      }
      setSaving(true)
      savingRef.current = true
      try {
        await saveEditedImageAs(ed.path, dataBase64)
      } catch {
        // notify already done in store
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [notify, saveEditedImageAs]
  )

  /** Pixels currently in the editor (crop, flip, filters), not the file on disk. */
  const readCurrentEditBase64 = useCallback((): string | null => {
    if (removeModeRef.current) return srcRef.current
    const fn = getCurrentImgDataFnRef.current
    if (typeof fn !== 'function') return null
    try {
      const savedType = fileName ? extToSavedType(fileName) : 'png'
      const extension = savedType === 'jpg' ? 'jpeg' : savedType
      const { imageData, hideLoadingSpinner } = fn(
        {
          name: 'edit',
          extension,
          quality: extension === 'jpeg' || extension === 'webp' ? 0.92 : undefined
        },
        false,
        true
      )
      try {
        hideLoadingSpinner?.()
      } catch {
        /* ignore */
      }
      return imageData?.imageBase64 ?? null
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not read the edited image', true)
      return null
    }
  }, [fileName, notify])

  const applyUndoLast = useCallback(async () => {
    const ed = editorRef.current
    if (!ed || savingRef.current || versionCountRef.current < 1) return
    setUndoConfirm(false)
    setSaving(true)
    savingRef.current = true
    try {
      const left = await useAppStore.getState().undoLastImageEdit(ed.path)
      if (left == null) return
      const res = await call(api.fs.readImageForEdit({ path: ed.path }))
      dirtyRef.current = false
      bakedFromDiskRef.current = false
      setRemoveMode(false)
      setDefaultToolId(TOOLS.CROP)
      setVersionCount(left)
      setSrc(`data:${res.mime};base64,${res.dataBase64}`)
      setSrcKey((k) => k + 1)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [])

  useEffect(() => {
    if (!undoConfirm) return
    let alive = true
    undoConfirmRef.current = true
    void (async () => {
      const ok = await useAppStore.getState().askConfirm({
        title: 'Undo last edit?',
        message:
          'This drops the newest saved version and opens the previous one. Unsaved changes in this window are discarded. The original file stays.',
        confirmLabel: 'Undo last',
        danger: true
      })
      if (!alive) return
      setUndoConfirm(false)
      if (ok) void applyUndoLast()
    })()
    return () => {
      alive = false
    }
  }, [undoConfirm, applyUndoLast])

  useEffect(() => {
    readCurrentEditBase64Ref.current = readCurrentEditBase64
    undoLastRef.current = () => {
      if (savingRef.current || versionCountRef.current < 1) return
      if (dirtyRef.current || bakedFromDiskRef.current) {
        setUndoConfirm(true)
        return
      }
      void applyUndoLast()
    }
    saveAsCurrentRef.current = () => {
      if (savingRef.current || removeBusyRef.current || bakingRef.current) return
      const data = readCurrentEditBase64()
      if (!data) {
        notify('Editor returned no image data', true)
        return
      }
      void runSaveAs(data)
    }
  }, [readCurrentEditBase64, runSaveAs, notify, applyUndoLast])

  // Filerobot is memo()'d, but a new Crop/theme/callback each parent render
  // rebuilds its config and the crop effect writes the last saved box back
  // over an in-progress handle drag. Keep these identities stable.
  const editorTabs = useMemo(
    () => [TABS.ADJUST, TABS.FINETUNE, TABS.FILTERS, TABS.ANNOTATE, TABS.RESIZE],
    []
  )
  const cropOptions = useMemo(
    () => ({
      ratio: 'custom' as const,
      ratioTitleKey: 'custom',
      noPresets: true,
      autoResize: true,
      // boundResizing multiplies the image box by canvasScale unless this is set.
      noScale: true
    }),
    []
  )
  const editorTheme = useMemo(
    () => ({
      palette: {
        'bg-primary': '#12141a',
        'bg-secondary': '#1a1d26',
        'accent-primary': '#3b82f6',
        'borders-secondary': '#2a2f3a',
        'text-primary': '#e8eaef',
        'text-secondary': '#9aa3b2'
      }
    }),
    []
  )
  const pixelRatio = useMemo(() => Math.min(2, window.devicePixelRatio || 1), [])
  const onEditorModify = useCallback((state: object) => {
    dirtyRef.current = Boolean(
      'hasUndo' in state && (state as { hasUndo?: boolean }).hasUndo
    )
  }, [])
  const onBeforeSave = useCallback(() => false, [])
  const onSave = useCallback(
    async (imageData: { imageBase64?: string }) => {
      if (!editor) return
      if (!imageEditShouldWrite({ hasUndo: dirtyRef.current, bakedFromDisk: bakedFromDiskRef.current })) {
        closeImageEditor()
        return
      }
      const data = imageData.imageBase64
      if (!data || !editor) {
        notify('Editor returned no image data', true)
        return
      }
      setSaving(true)
      savingRef.current = true
      try {
        await saveEditedImage(editor.path, data)
      } catch {
        // notify already done in store
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [editor, notify, saveEditedImage, closeImageEditor]
  )
  const onClose = useCallback(() => {
    if (!savingRef.current && !bakingRef.current) closeImageEditor()
  }, [closeImageEditor])

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
              dirtyRef.current = false
              bakedFromDiskRef.current = true
              setSrc(dataUrl)
              setSrcKey((k) => k + 1)
              setDefaultToolId(TOOLS.CROP)
              setRemoveMode(false)
              notify('Remove applied — Save when ready', false)
            }}
          />
        ) : (
          <FilerobotImageEditor
            key={srcKey}
            source={src}
            tabsIds={editorTabs}
            defaultTabId={TABS.ADJUST}
            defaultToolId={defaultToolId}
            useAiTab={false}
            closeAfterSave
            avoidChangesNotSavedAlertOnLeave
            resetOnSourceChange={false}
            // Skip Filerobot’s own “save as” modal — Save overwrites in place via onSave.
            onBeforeSave={onBeforeSave}
            defaultSavedImageName={name.replace(/\.[^.]+$/, '') || name}
            defaultSavedImageType={extToSavedType(editor.path)}
            savingPixelRatio={pixelRatio}
            previewPixelRatio={1}
            getCurrentImgDataFnRef={getCurrentImgDataFnRef}
            onModify={onEditorModify}
            Crop={cropOptions}
            theme={editorTheme}
            onSave={onSave}
            onClose={onClose}
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
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif' || ext === 'bmp') return 'jpeg'
  if (ext === 'webp') return 'webp'
  return 'png'
}
