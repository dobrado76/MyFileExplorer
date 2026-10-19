import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { Splitter } from './Splitter'
import { FLOATING_RESIZE_EDGES, useFloatingModalBounds } from '../lib/floatingModalBounds'
import {
  CAMERA_LOOK_CUSTOM_CONTROL_MAX,
  CAMERA_LOOKS,
  cameraLookControlNameError,
  cameraLookControlParam,
  cameraLookParamNumber,
  cameraLookPathMatches,
  cameraLookSettingsSchema,
  cameraLookUniformNames,
  isCustomCameraLookId,
  newCameraLookCustomId,
  nextCameraLookControlName,
  cameraLookParamValues,
  cameraLookParamsFor,
  cameraLookDustCount,
  cameraLookSeedForIndex,
  cameraLookTemperature,
  clampCameraLookParam,
  defaultCameraLookCustomControl,
  replaceCameraLookControls,
  type CameraLookCustomControl,
  type CameraLookParam,
  type CameraLookSettings
} from '@shared/cameraLook'
import { useAppStore } from '../store/appStore'
import { api } from '../lib/ipc'
import { CloseIcon, isImageExt } from '../lib/icons'
import { basename } from '../lib/paths'
import { CAMERA_LOOK_CUSTOM_PLACEHOLDER } from '../lib/cameraLookShaders'
import {
  cameraLookCompileError,
  cameraLookSourceSize,
  drawCameraLook,
  loadCameraLookSource,
  releaseCameraLookSource
} from '../lib/cameraLookGl'

type Props = {
  returnSection?: string
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function shownPreviewFraction(rowWidth: number, fraction: number): number {
  if (rowWidth < 80) return fraction
  const usable = rowWidth - 5
  const minFraction = 200 / usable
  const maxFraction = (usable - 240) / usable
  if (!(maxFraction > minFraction)) return 0.5
  return Math.min(Math.min(0.85, maxFraction), Math.max(Math.max(0.2, minFraction), fraction))
}

function temperatureLabel(n: number): string {
  const v = Math.round(n * 100) / 100
  const text = `${v > 0 ? '+' : ''}${v.toFixed(2)}`
  if (Math.abs(v) < 0.005) return `${text} normal`
  return v < 0 ? `${text} cold` : `${text} warm`
}

function CustomSliderRow({
  control,
  value,
  siblingNames,
  onCommit,
  onValue,
  onRemove
}: {
  control: CameraLookCustomControl
  value: number
  siblingNames: readonly string[]
  onCommit: (next: CameraLookCustomControl) => void
  onValue: (value: number) => void
  onRemove: () => void
}): JSX.Element {
  const param = cameraLookControlParam(control)
  const [nameText, setNameText] = useState(control.name)
  const [minText, setMinText] = useState(String(control.min))
  const [maxText, setMaxText] = useState(String(control.max))
  const [defText, setDefText] = useState(String(control.default))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setNameText(control.name)
    setMinText(String(control.min))
    setMaxText(String(control.max))
    setDefText(String(control.default))
    setError(null)
  }, [control.name, control.min, control.max, control.default])

  const commit = (): void => {
    const name = nameText.trim()
    const err = cameraLookControlNameError(name, siblingNames)
    if (err) {
      setError(err)
      setNameText(control.name)
      return
    }
    const minN = Number(minText)
    const maxN = Number(maxText)
    const defN = Number(defText)
    if (!Number.isFinite(minN) || !Number.isFinite(maxN) || !Number.isFinite(defN)) {
      setMinText(String(control.min))
      setMaxText(String(control.max))
      setDefText(String(control.default))
      return
    }
    if (name === control.name && minN === control.min && maxN === control.max && defN === control.default) {
      setError(null)
      return
    }
    setError(null)
    onCommit({ name, min: minN, max: maxN, default: defN })
  }

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  return (
    <div className="camera-look-slider">
      <div className="camera-look-slider-meta">
        <input
          className="camera-look-slider-name"
          value={nameText}
          aria-label="Variable name"
          spellCheck={false}
          onChange={(e) => setNameText(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
        />
        <label>
          Min
          <input
            type="number"
            aria-label={`${control.name} minimum`}
            value={minText}
            step="any"
            onChange={(e) => setMinText(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
          />
        </label>
        <label>
          Max
          <input
            type="number"
            aria-label={`${control.name} maximum`}
            value={maxText}
            step="any"
            onChange={(e) => setMaxText(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
          />
        </label>
        <label>
          Default
          <input
            type="number"
            aria-label={`${control.name} default`}
            value={defText}
            step="any"
            onChange={(e) => setDefText(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
          />
        </label>
        <button type="button" className="btn" onClick={onRemove}>
          Remove slider
        </button>
      </div>
      {error ? <p className="camera-look-slider-error">{error}</p> : null}
      <label className="camera-look-slider-value">
        <span className="dim">Current</span>
        <input
          type="range"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          aria-label={`${control.name} current value`}
          onChange={(e) => onValue(Number(e.target.value))}
        />
        <input
          type="number"
          min={param.min}
          max={param.max}
          step={param.step}
          value={value}
          aria-label={`${control.name} current number`}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onValue(n)
          }}
        />
      </label>
    </div>
  )
}

/**
 * Editor for slideshow camera looks. One effect at a time, with its own controls.
 */
export function CameraLookDialog({ returnSection }: Props): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const stored = useAppStore((s) => s.settings.slideshow.cameraLook)
  const look = useMemo(() => cameraLookSettingsSchema.parse(stored ?? {}), [stored])
  const selectedPath = useAppStore((s) => s.activeTab().selected[0] ?? '')
  const [previewId, setPreviewId] = useState<string>(CAMERA_LOOKS[0]!.id)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [photoPath, setPhotoPath] = useState(() =>
    selectedPath && isImageExt(extOf(selectedPath)) ? selectedPath : ''
  )
  const [customDraft, setCustomDraft] = useState('')
  const [draftFor, setDraftFor] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [compileError, setCompileError] = useState<string | null>(null)
  const [photo, setPhoto] = useState<CanvasImageSource | null>(null)
  const [photoNote, setPhotoNote] = useState('')
  const [stageTick, setStageTick] = useState(0)
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const splitRef = useRef<HTMLDivElement | null>(null)

  const savedBounds = useAppStore((s) => s.settings.cameraLookBounds)
  const [previewFraction, setPreviewFraction] = useState(() => savedBounds?.previewFraction ?? 0.58)
  const [splitWidth, setSplitWidth] = useState(0)
  const fractionRef = useRef(previewFraction)
  const persistBounds = useCallback(
    (next: { x: number; y: number; width: number; height: number }, isMax: boolean): void => {
      void applySettingsPatch({
        cameraLookBounds: { ...next, maximized: isMax, previewFraction: fractionRef.current }
      })
    },
    [applySettingsPatch]
  )
  const onSplitDrag = useCallback((delta: number): void => {
    const row = splitRef.current
    if (!row) return
    const usable = Math.max(1, row.clientWidth - 5)
    const minFraction = 200 / usable
    const maxFraction = (usable - 240) / usable
    const limit = maxFraction <= minFraction ? 0.5 : Math.min(0.85, Math.max(0.2, maxFraction))
    const floor = maxFraction <= minFraction ? 0.5 : Math.min(limit, Math.max(0.2, minFraction))
    const next = Math.min(limit, Math.max(floor, fractionRef.current + delta / usable))
    fractionRef.current = next
    setPreviewFraction(next)
  }, [])
  const { bounds, maximized, beginDrag, toggleMaximize } = useFloatingModalBounds({
    saved: savedBounds,
    persist: persistBounds,
    minW: 640,
    minH: 420,
    defaultW: 1080,
    defaultH: 780,
    allowMaximize: true
  })

  const finish = useCallback((): void => {
    if (returnSection) openDialog({ kind: 'settings', section: returnSection })
    else closeDialog()
  }, [returnSection, openDialog, closeDialog])

  useEffect(() => {
    const row = splitRef.current
    if (!row) return
    const measure = (): void => setSplitWidth(row.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      finish()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [finish])

  const selectedCustom = isCustomCameraLookId(previewId)
    ? (look.customs ?? []).find((item) => item.id === previewId) ?? null
    : null

  useEffect(() => {
    if (!selectedCustom) return
    if (draftFor === selectedCustom.id) return
    setCustomDraft(selectedCustom.fragment)
    setDraftFor(selectedCustom.id)
    setNameDraft(selectedCustom.name)
  }, [selectedCustom, draftFor])

  useEffect(() => {
    if (!photoPath || !isImageExt(extOf(photoPath))) {
      setPhoto(null)
      setPhotoNote(photoPath ? 'That file is not a previewable image.' : '')
      return
    }
    let cancelled = false
    let loaded: CanvasImageSource | null = null
    setPhotoNote('Loading…')
    void api.preview.getDisplayUrl({ path: photoPath }).then(async (res) => {
      if (cancelled || !res.ok || !res.value.mediaUrl) {
        if (!cancelled) setPhotoNote('Could not open that photo.')
        return
      }
      const src = await loadCameraLookSource(res.value.mediaUrl)
      if (cancelled || !src) {
        if (src) releaseCameraLookSource(src)
        if (!cancelled) setPhotoNote('Could not decode that photo.')
        return
      }
      loaded = src
      setPhoto(src)
      setPhotoNote('')
    })
    return () => {
      cancelled = true
      if (loaded) releaseCameraLookSource(loaded)
    }
  }, [photoPath])

  useEffect(() => {
    if (!selectedCustom) {
      setCompileError(null)
      return
    }
    if (!customDraft.includes('vec3 apply')) {
      setCompileError(customDraft.trim() ? 'Define vec3 apply(vec2 p, vec3 col, float seed).' : null)
      return
    }
    const names = selectedCustom.controls.map((control) => control.name)
    const timer = window.setTimeout(() => {
      setCompileError(cameraLookCompileError(customDraft, names))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [selectedCustom, customDraft])

  const uniformKey = (selectedCustom?.controls ?? []).map((control) => control.name).join('\n')
  const paramKey = cameraLookParamValues(previewId, look.params, look.customs).join(',')

  useEffect(() => {
    const parent = previewRef.current?.parentElement
    if (!parent) return
    let last = ''
    const ro = new ResizeObserver(() => {
      const next = `${parent.clientWidth}x${parent.clientHeight}`
      if (next === last) return
      last = next
      setStageTick((n) => n + 1)
    })
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = previewRef.current
    if (!canvas || !photo) return
    const sized = cameraLookSourceSize(photo)
    if (!sized) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      void drawCameraLook(
        canvas,
        photo,
        sized.w,
        sized.h,
        previewId,
        cameraLookSeedForIndex(previewIndex),
        selectedCustom ? customDraft : '',
        cameraLookParamValues(previewId, look.params, look.customs),
        () => true,
        selectedCustom ? cameraLookUniformNames(look, previewId) : undefined
      )
    }, 40)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [previewId, customDraft, selectedCustom, photo, previewIndex, paramKey, uniformKey, look, stageTick])

  const save = (next: CameraLookSettings): void => {
    void applySettingsPatch({ slideshow: { cameraLook: next } })
  }

  const setEnabled = (enabledIds: string[]): void => {
    save({ ...look, enabledIds })
  }

  const toggle = (id: string, on: boolean): void => {
    const enabledIds = on
      ? look.enabledIds.includes(id)
        ? look.enabledIds
        : [...look.enabledIds, id]
      : look.enabledIds.filter((item) => item !== id)
    save({ ...look, enabledIds })
  }

  const addCustom = (): void => {
    const customs = look.customs ?? []
    if (customs.length >= 24) return
    const id = newCameraLookCustomId(customs.map((item) => item.id))
    const entry = {
      id,
      name: `Custom ${customs.length + 1}`,
      fragment: '',
      controls: [defaultCameraLookCustomControl()]
    }
    save({
      ...look,
      customs: [...customs, entry],
      enabledIds: look.enabledIds.includes(id) ? look.enabledIds : [...look.enabledIds, id]
    })
    setDraftFor('')
    setPreviewId(id)
  }

  const removeCustom = (id: string): void => {
    const params = { ...look.params }
    delete params[id]
    save({
      ...look,
      customs: (look.customs ?? []).filter((item) => item.id !== id),
      enabledIds: look.enabledIds.filter((item) => item !== id),
      params
    })
    if (previewId === id) {
      setDraftFor('')
      setPreviewId(CAMERA_LOOKS[0]!.id)
    }
  }

  const renameCustom = (id: string, name: string): void => {
    const next = name.trim().slice(0, 48)
    if (!next) return
    save({
      ...look,
      customs: (look.customs ?? []).map((item) => (item.id === id ? { ...item, name: next } : item))
    })
  }

  const saveCustomFragment = (id: string, fragment: string): void => {
    save({
      ...look,
      customs: (look.customs ?? []).map((item) => (item.id === id ? { ...item, fragment } : item))
    })
  }

  const setParam = (def: CameraLookParam, value: number): void => {
    const snapped = clampCameraLookParam(def, value)
    const row = { ...(look.params[previewId] ?? {}) }
    if (Math.abs(snapped - def.default) <= 1e-6) delete row[def.id]
    else row[def.id] = snapped
    const params = { ...look.params }
    if (Object.keys(row).length === 0) delete params[previewId]
    else params[previewId] = row
    save({ ...look, params })
  }

  const resetLook = (): void => {
    const params = { ...look.params }
    delete params[previewId]
    save({ ...look, params })
  }

  const addSlider = (): void => {
    if (!selectedCustom || selectedCustom.controls.length >= CAMERA_LOOK_CUSTOM_CONTROL_MAX) return
    const controls = [
      ...selectedCustom.controls,
      {
        name: nextCameraLookControlName(selectedCustom.controls.map((control) => control.name)),
        min: 0,
        max: 1,
        default: 1
      }
    ]
    save(replaceCameraLookControls(look, selectedCustom.id, controls))
  }

  const commitSlider = (index: number, next: CameraLookCustomControl): void => {
    if (!selectedCustom) return
    const previous = selectedCustom.controls[index]
    if (!previous) return
    const controls = selectedCustom.controls.map((control, i) => (i === index ? next : control))
    save(
      replaceCameraLookControls(look, selectedCustom.id, controls, {
        from: previous.name,
        to: next.name
      })
    )
  }

  const removeSlider = (index: number): void => {
    if (!selectedCustom) return
    const controls = selectedCustom.controls.filter((_, i) => i !== index)
    save(replaceCameraLookControls(look, selectedCustom.id, controls))
  }

  const useSelection = (): void => {
    if (selectedPath && isImageExt(extOf(selectedPath))) setPhotoPath(selectedPath)
    else setPhotoNote('Select an image in the file list first.')
  }

  const browse = (): void => {
    void api.slideshow
      .pickOpenFile({
        title: 'Preview photo',
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff'] }
        ]
      })
      .then((res) => {
        if (res.ok && res.value.path) setPhotoPath(res.value.path)
      })
  }

  const meta = selectedCustom
    ? {
        name: selectedCustom.name,
        hint: 'Each slider is a shader variable. Set its name, range, and the value Reset uses.'
      }
    : CAMERA_LOOKS.find((item) => item.id === previewId)
  const defs = selectedCustom ? [] : cameraLookParamsFor(previewId)
  const dirty = look.params[previewId] != null

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && finish()}
    >
      <div
        className={`modal camera-look-dialog${maximized ? ' is-maximized' : ''}`}
        role="dialog"
        aria-label="Camera looks"
        style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!maximized &&
          FLOATING_RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className={`modal-resize-handle ${edge}`}
              onPointerDown={(e) => beginDrag(edge, e)}
            />
          ))}
        <div
          className="modal-title modal-title-chrome"
          onPointerDown={maximized ? undefined : (e) => beginDrag('move', e)}
          onDoubleClick={(e) => {
            e.preventDefault()
            toggleMaximize()
          }}
        >
          <span className="modal-title-text">Camera looks</span>
          <button
            type="button"
            className="modal-title-btn"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            title={maximized ? 'Restore' : 'Maximize'}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleMaximize()
            }}
          >
            {maximized ? (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="3" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <rect
                  x="1"
                  y="3"
                  width="7"
                  height="7"
                  fill="var(--bg, #1a1d24)"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="modal-title-btn"
            aria-label="Close"
            title="Close"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              finish()
            }}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="camera-look-toolbar">
          <label className="settings-inline camera-look-frequency">
            <span>Frequency</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={look.frequencyPct}
              onChange={(e) =>
                save({ ...look, frequencyPct: Number(e.target.value) })
              }
            />
            <span>{look.frequencyPct}%</span>
          </label>
          {[0, 35, 70, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              className="btn"
              onClick={() => save({ ...look, frequencyPct: pct })}
            >
              {pct}%
            </button>
          ))}
          <label className="settings-inline camera-look-path-filter">
            <span>Path filter</span>
            <input
              type="text"
              spellCheck={false}
              placeholder="empty = every photo"
              aria-label="Path filter"
              title="The slideshow path must contain this text. AI matches those letters anywhere. \AI\ matches a folder named AI anywhere on the path."
              value={look.pathFilter}
              onChange={(e) => save({ ...look, pathFilter: e.target.value })}
            />
          </label>
          <span className="dim camera-look-toolbar-note">
            In a slideshow the list index picks the look. 0% leaves every slide untouched. This
            window always previews the one you select.
          </span>
        </div>
        <div className="camera-look-layout">
          <div className="camera-look-list">
            <div className="camera-look-list-actions">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setEnabled([
                    ...CAMERA_LOOKS.map((item) => item.id),
                    ...(look.customs ?? []).map((item) => item.id)
                  ])
                }
              >
                Enable all
              </button>
              <button type="button" className="btn" onClick={() => setEnabled([])}>
                Disable all
              </button>
            </div>
            <div className="camera-look-list-scroll">
            {CAMERA_LOOKS.map((item) => (
              <div
                key={item.id}
                className={`camera-look-row${previewId === item.id ? ' is-on' : ''}`}
                onClick={() => setPreviewId(item.id)}
              >
                <input
                  type="checkbox"
                  checked={look.enabledIds.includes(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => toggle(item.id, e.target.checked)}
                  aria-label={`Enable ${item.name}`}
                />
                <span>{item.name}</span>
              </div>
            ))}
            {(look.customs ?? []).map((item) => (
              <div
                key={item.id}
                className={`camera-look-row${previewId === item.id ? ' is-on' : ''}`}
                onClick={() => setPreviewId(item.id)}
              >
                <input
                  type="checkbox"
                  checked={look.enabledIds.includes(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => toggle(item.id, e.target.checked)}
                  aria-label={`Enable ${item.name}`}
                />
                <span>{item.name}</span>
              </div>
            ))}
            </div>
            <div className="camera-look-list-actions camera-look-list-add">
              <button
                type="button"
                className="btn"
                disabled={(look.customs ?? []).length >= 24}
                onClick={addCustom}
              >
                Add custom
              </button>
            </div>
          </div>
          <div className="camera-look-main" ref={splitRef}>
            <div
              className="camera-look-preview"
              style={{ width: `calc((100% - 5px) * ${shownPreviewFraction(splitWidth, previewFraction)})` }}
            >
            <div className="camera-look-photo-row">
              <span className="dim" title={photoPath}>
                {photoPath ? basename(photoPath) : 'No photo'}
              </span>
              {look.pathFilter.trim() && photoPath && !cameraLookPathMatches(look.pathFilter, photoPath) ? (
                <span className="dim">Slideshow skips this photo.</span>
              ) : null}
              <button type="button" className="btn" onClick={useSelection}>
                Use selection
              </button>
              <button type="button" className="btn" onClick={browse}>
                Browse…
              </button>
              <label className="settings-inline camera-look-index">
                <span>Slide index</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={previewIndex}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n >= 0) setPreviewIndex(Math.floor(n))
                  }}
                />
              </label>
              {previewId === 'temperature' ? (
                <span className="dim">
                  Rolls {temperatureLabel(
                    cameraLookTemperature(
                      cameraLookSeedForIndex(previewIndex),
                      cameraLookParamNumber(previewId, look.params, 'coldest'),
                      cameraLookParamNumber(previewId, look.params, 'warmest')
                    )
                  )}
                </span>
              ) : null}
              {previewId === 'dusty-lens' ? (
                <span className="dim">
                  Rolls{' '}
                  {cameraLookDustCount(
                    cameraLookSeedForIndex(previewIndex),
                    cameraLookParamNumber(previewId, look.params, 'minCount'),
                    cameraLookParamNumber(previewId, look.params, 'maxCount')
                  )}{' '}
                  particles
                </span>
              ) : null}
            </div>
            <div className="camera-look-stage-wrap">
              <canvas ref={previewRef} className="camera-look-stage" aria-label="Camera look preview" />
              {!photo ? (
                <div className="camera-look-stage-empty">
                  {photoNote || 'Choose a photo to preview this look.'}
                </div>
              ) : null}
            </div>
            </div>
            <Splitter
              onDrag={onSplitDrag}
              onDragEnd={() => {
                const saved = maximized ? useAppStore.getState().settings.cameraLookBounds : null
                persistBounds(
                  saved
                    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
                    : bounds,
                  maximized
                )
              }}
            />
            <div className="camera-look-controls">
              <div className="camera-look-controls-head">
                <div>
                  {selectedCustom ? (
                    <input
                      className="camera-look-name"
                      value={nameDraft}
                      aria-label="Custom name"
                      spellCheck={false}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onBlur={() => {
                        if (nameDraft.trim() && nameDraft.trim() !== selectedCustom.name) {
                          renameCustom(selectedCustom.id, nameDraft)
                        } else {
                          setNameDraft(selectedCustom.name)
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      }}
                    />
                  ) : (
                    <strong>{meta?.name ?? previewId}</strong>
                  )}
                  {meta && 'hint' in meta && meta.hint ? (
                    <div className="dim">{meta.hint}</div>
                  ) : null}
                </div>
                <div className="camera-look-controls-actions">
                  {selectedCustom ? (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={selectedCustom.controls.length >= CAMERA_LOOK_CUSTOM_CONTROL_MAX}
                        onClick={addSlider}
                      >
                        Add slider
                      </button>
                      <button type="button" className="btn" onClick={() => removeCustom(selectedCustom.id)}>
                        Remove
                      </button>
                    </>
                  ) : null}
                  <button type="button" className="btn" disabled={!dirty} onClick={resetLook}>
                    Reset to defaults
                  </button>
                </div>
              </div>
              {selectedCustom ? (
                <div className="camera-look-sliders">
                  {selectedCustom.controls.length === 0 ? (
                    <p className="dim">No sliders. Add one when the shader needs a variable.</p>
                  ) : null}
                  {selectedCustom.controls.map((control, index) => (
                    <CustomSliderRow
                      key={`${selectedCustom.id}:${control.name}`}
                      control={control}
                      value={cameraLookParamNumber(previewId, look.params, control.name, look.customs)}
                      siblingNames={selectedCustom.controls
                        .filter((item) => item.name !== control.name)
                        .map((item) => item.name)}
                      onCommit={(next) => commitSlider(index, next)}
                      onValue={(next) => setParam(cameraLookControlParam(control), next)}
                      onRemove={() => removeSlider(index)}
                    />
                  ))}
                </div>
              ) : null}
              {defs.map((def) => {
                const value = cameraLookParamNumber(previewId, look.params, def.id)
                if (def.options) {
                  return (
                    <label key={def.id} className="camera-look-field">
                      <span>{def.label}</span>
                      <select value={value} onChange={(e) => setParam(def, Number(e.target.value))}>
                        {def.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                }
                return (
                  <label key={def.id} className="camera-look-field">
                    <span>
                      {def.label}
                      {def.hint ? <span className="dim camera-look-hint">{def.hint}</span> : null}
                    </span>
                    <input
                      type="range"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={value}
                      onChange={(e) => setParam(def, Number(e.target.value))}
                    />
                    <input
                      type="number"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={value}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (Number.isFinite(n)) setParam(def, n)
                      }}
                    />
                  </label>
                )
              })}
              {selectedCustom ? (
                <>
                  <textarea
                    value={customDraft}
                    spellCheck={false}
                    placeholder={CAMERA_LOOK_CUSTOM_PLACEHOLDER}
                    onChange={(e) => setCustomDraft(e.target.value)}
                    onBlur={() => {
                      if (customDraft !== selectedCustom.fragment) {
                        saveCustomFragment(selectedCustom.id, customDraft)
                      }
                    }}
                    className="camera-look-code"
                  />
                  {compileError ? (
                    <p className="dim camera-look-error">{compileError}</p>
                  ) : customDraft.includes('vec3 apply') ? (
                    <p className="dim">Custom shader compiles.</p>
                  ) : (
                    <p className="dim">The preview stays the photo until this defines vec3 apply().</p>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={finish}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
