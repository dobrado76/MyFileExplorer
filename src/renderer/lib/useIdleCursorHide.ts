import { useEffect, useState } from 'react'

const IDLE_CLASS = 'idle-cursor-hidden'

/**
 * Hide the mouse cursor after `idleMs` of no pointer/wheel activity.
 * Applies `html.idle-cursor-hidden` so it works across the whole window
 * (needed for Electron when a child window or chrome would otherwise keep a cursor).
 */
export function useIdleCursorHide(enabled: boolean, idleMs = 2000): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const clearHide = (): void => {
      setHidden(false)
      root.classList.remove(IDLE_CLASS)
    }

    if (!enabled) {
      clearHide()
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    const armHide = (): void => {
      if (timer != null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        setHidden(true)
        root.classList.add(IDLE_CLASS)
      }, idleMs)
    }

    const onActivity = (): void => {
      clearHide()
      armHide()
    }

    armHide()
    window.addEventListener('pointermove', onActivity, true)
    window.addEventListener('pointerdown', onActivity, true)
    window.addEventListener('wheel', onActivity, true)
    return () => {
      if (timer != null) clearTimeout(timer)
      window.removeEventListener('pointermove', onActivity, true)
      window.removeEventListener('pointerdown', onActivity, true)
      window.removeEventListener('wheel', onActivity, true)
      root.classList.remove(IDLE_CLASS)
    }
  }, [enabled, idleMs])

  return hidden
}
