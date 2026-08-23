import { describe, expect, it, vi, beforeEach } from 'vitest'
import { handleSlideshowRelayEvent } from '../renderer/lib/slideshowRelay'
import type { MfeEvent } from '@shared/ipc/contract'

function mockStore(overrides: {
  active?: {
    status: 'playing' | 'manual' | 'building'
    index: number
    compiledMode: boolean
    compiledTotal: number
    currentPath: string | null
    paths: string[]
    actions: []
    builtFromCache: boolean
    buildFound: number
    buildCurrent: string
  } | null
  dialog?: unknown
  imageEditor?: unknown
  contextMenu?: unknown
}) {
  const interrupt = vi.fn()
  const navigate = vi.fn()
  const stop = vi.fn()
  const resume = vi.fn()
  const openContextMenu = vi.fn()
  const state = {
    slideshow: { active: overrides.active ?? null },
    dialog: overrides.dialog ?? null,
    imageEditor: overrides.imageEditor ?? null,
    contextMenu: overrides.contextMenu ?? null,
    slideshowInterrupt: interrupt,
    slideshowNavigate: navigate,
    slideshowResumePlaying: resume,
    stopSlideshow: stop,
    openContextMenu
  }
  return { state, interrupt, navigate, stop, resume, openContextMenu }
}

describe('slideshowRelay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('interrupts autoplay and navigates on arrow keys from lists window', () => {
    const { state, interrupt, navigate } = mockStore({
      active: {
        status: 'playing',
        index: 2,
        compiledMode: true,
        compiledTotal: 10,
        currentPath: 'C:\\a.jpg',
        paths: [],
        actions: [],
        builtFromCache: true,
        buildFound: 10,
        buildCurrent: ''
      }
    })
    const event: MfeEvent = {
      type: 'slideshow-key',
      payload: {
        key: 'ArrowRight',
        code: 'ArrowRight',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false
      }
    }
    handleSlideshowRelayEvent(event, () => state as never)
    expect(interrupt).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(1)
  })

  it('relays wheel to prev/next with interrupt', () => {
    const { state, interrupt, navigate } = mockStore({
      active: {
        status: 'playing',
        index: 1,
        compiledMode: true,
        compiledTotal: 5,
        currentPath: 'C:\\b.jpg',
        paths: [],
        actions: [],
        builtFromCache: true,
        buildFound: 5,
        buildCurrent: ''
      }
    })
    handleSlideshowRelayEvent(
      {
        type: 'slideshow-pointer',
        payload: { kind: 'wheel', deltaX: 0, deltaY: 40, ctrlKey: false, metaKey: false }
      },
      () => state as never
    )
    expect(interrupt).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(1)
  })

  it('navigates when Electron sends Left instead of ArrowLeft', () => {
    const { state, interrupt, navigate } = mockStore({
      active: {
        status: 'playing',
        index: 2,
        compiledMode: true,
        compiledTotal: 10,
        currentPath: 'C:\\a.jpg',
        paths: [],
        actions: [],
        builtFromCache: true,
        buildFound: 10,
        buildCurrent: ''
      }
    })
    handleSlideshowRelayEvent(
      {
        type: 'slideshow-key',
        payload: {
          key: 'Left',
          code: 'ArrowLeft',
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false
        }
      },
      () => state as never
    )
    expect(interrupt).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(-1)
  })

  it('stops on Escape relay', () => {
    const { state, stop } = mockStore({
      active: {
        status: 'playing',
        index: 0,
        compiledMode: true,
        compiledTotal: 5,
        currentPath: 'C:\\a.jpg',
        paths: [],
        actions: [],
        builtFromCache: true,
        buildFound: 5,
        buildCurrent: ''
      }
    })
    handleSlideshowRelayEvent(
      {
        type: 'slideshow-key',
        payload: {
          key: 'Escape',
          code: 'Escape',
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false
        }
      },
      () => state as never
    )
    expect(stop).toHaveBeenCalledOnce()
  })
})
