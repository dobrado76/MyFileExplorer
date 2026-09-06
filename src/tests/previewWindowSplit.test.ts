import { describe, expect, it } from 'vitest'
import {
  PREVIEW_WINDOW_SPLIT_DEFAULT_RATIO,
  PREVIEW_WINDOW_SPLIT_GUTTER,
  PREVIEW_WINDOW_SPLIT_LEFT_MIN,
  PREVIEW_WINDOW_SPLIT_RIGHT_MIN,
  applyPreviewWindowSplitDelta,
  previewWindowSplitRightPx
} from '../shared/previewWindowSplit'
import {
  defaultSettings,
  settingsPatchSchema,
  settingsSchema
} from '../shared/schemas/settings'
import { settingsForPortableExport } from '../shared/schemas/settingsExport'

describe('previewWindowSplitRightPx', () => {
  it('uses 42% when nothing is saved', () => {
    expect(previewWindowSplitRightPx(1000, null)).toBe(
      Math.round(1000 * PREVIEW_WINDOW_SPLIT_DEFAULT_RATIO)
    )
  })

  it('keeps a saved width when it fits', () => {
    expect(previewWindowSplitRightPx(1200, 360)).toBe(360)
  })

  it('clamps so the left column keeps its minimum', () => {
    const width = 500
    const max =
      width - PREVIEW_WINDOW_SPLIT_LEFT_MIN - PREVIEW_WINDOW_SPLIT_GUTTER
    expect(previewWindowSplitRightPx(width, 800)).toBe(max)
  })

  it('clamps below the right-column minimum', () => {
    expect(previewWindowSplitRightPx(1000, 80)).toBe(PREVIEW_WINDOW_SPLIT_RIGHT_MIN)
  })

  it('dragging right shrinks the details column', () => {
    expect(applyPreviewWindowSplitDelta(400, 40, 1200)).toBe(360)
  })
})

describe('previewWindowSplitPx setting', () => {
  it('defaults to null (use 42%)', () => {
    expect(settingsSchema.parse({}).previewWindowSplitPx).toBeNull()
    expect(defaultSettings.previewWindowSplitPx).toBeNull()
  })

  it('round-trips a user width through patch + full schema', () => {
    const patch = settingsPatchSchema.parse({ previewWindowSplitPx: 360 })
    expect(patch).toEqual({ previewWindowSplitPx: 360 })
    const next = settingsSchema.parse({ ...defaultSettings, ...patch })
    expect(next.previewWindowSplitPx).toBe(360)
  })

  it('is a preference — portable export keeps it (not window geometry)', () => {
    const portable = settingsForPortableExport({
      ...defaultSettings,
      previewWindowSplitPx: 400
    })
    expect(portable.previewWindowSplitPx).toBe(400)
  })
})
