/**
 * Compiled lists window → main slideshow input.
 * Handled in the store's permanent `api.onEvent` subscription so slide / playlist
 * rebuilds never drop the listener (overlay effects re-subscribe on every `active` change).
 */
import type { MfeEvent } from '@shared/ipc/contract'
import {
  isSlideshowStopKey,
  normalizeSlideshowKeyLike,
  type SlideshowKeyLike
} from '@shared/slideshow/keys'
import { slideshowCurrentPath } from './slideshowTypes'

export type SlideshowRelayStore = {
  slideshow: { active: import('./slideshowTypes').SlideshowState | null }
  dialog: unknown
  imageEditor: unknown
  contextMenu: unknown
  slideshowInterrupt(): void
  slideshowNavigate(dir: -1 | 1 | 'first' | 'last'): void
  slideshowResumePlaying(): void
  stopSlideshow(): Promise<void>
  openContextMenu(req: {
    x: number
    y: number
    paths: string[]
    slideshow?: boolean
  }): void
}

let wheelLock = false

function navFromKey(s: SlideshowRelayStore, raw: SlideshowKeyLike): boolean {
  const e = normalizeSlideshowKeyLike(raw)
  const key = e.key
  const code = e.code
  if (key === 'Home' || code === 'Home') {
    s.slideshowNavigate('first')
    return true
  }
  if (key === 'End' || code === 'End') {
    s.slideshowNavigate('last')
    return true
  }
  if (
    key === 'ArrowLeft' ||
    key === 'ArrowUp' ||
    key === 'PageUp' ||
    code === 'ArrowLeft' ||
    code === 'ArrowUp' ||
    code === 'PageUp'
  ) {
    s.slideshowNavigate(-1)
    return true
  }
  if (
    key === 'ArrowRight' ||
    key === 'ArrowDown' ||
    key === 'PageDown' ||
    code === 'ArrowRight' ||
    code === 'ArrowDown' ||
    code === 'PageDown'
  ) {
    s.slideshowNavigate(1)
    return true
  }
  return false
}

export function handleSlideshowRelayEvent(
  event: MfeEvent,
  get: () => SlideshowRelayStore
): void {
  const s = get()

  if (event.type === 'slideshow-key') {
    if (event.payload.phase === 'up') return
    const e = normalizeSlideshowKeyLike(event.payload)
    const a = s.slideshow.active
    if (!a) return
    if (s.dialog || s.imageEditor || s.contextMenu) return

    if (isSlideshowStopKey(e)) {
      void s.stopSlideshow()
      return
    }
    if (a.status === 'building') return

    if (e.key === 'Enter' || e.code === 'Enter') {
      if (a.status === 'manual') s.slideshowResumePlaying()
      return
    }

    if (a.status === 'playing') s.slideshowInterrupt()
    navFromKey(s, e)
    return
  }

  if (event.type !== 'slideshow-pointer') return

  const a = s.slideshow.active
  if (!a) return
  if (s.dialog || s.imageEditor || s.contextMenu) return

  const p = event.payload
  if (p.kind === 'click') {
    void s.stopSlideshow()
    return
  }
  if (p.kind === 'contextmenu') {
    const cur = slideshowCurrentPath(a)
    s.openContextMenu({
        x: Math.round(globalThis.innerWidth / 2),
        y: Math.round(globalThis.innerHeight / 2),
      paths: cur ? [cur] : [],
      slideshow: true
    })
    return
  }
  if (p.kind !== 'wheel') return
  if (a.status === 'building') return
  if (p.ctrlKey || p.metaKey) return
  const dy = p.deltaY
  const dx = p.deltaX
  if (Math.abs(dy) < 2 && Math.abs(dx) < 2) return
  if (wheelLock) return
  wheelLock = true
  if (a.status === 'playing') s.slideshowInterrupt()
  const delta = dy !== 0 ? dy : dx
  s.slideshowNavigate(delta < 0 ? -1 : 1)
  globalThis.setTimeout(() => {
    wheelLock = false
  }, 160)
}
