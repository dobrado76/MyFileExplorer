import { useEffect, useState } from 'react'
import { api } from './ipc'

/**
 * True after `idleMs` with no pointer/wheel activity on this window.
 * Used for detached / Now Playing video chrome (not docked preview).
 *
 * When `listenMpvPointer` is set, also treats main-process cursor polls over
 * the Rich player owner window (incl. the mpv overlay) as activity — Chromium
 * never sees those moves otherwise.
 */
export function usePointerIdle(
  enabled: boolean,
  idleMs = 3000,
  opts?: { listenMpvPointer?: boolean }
): boolean {
  const [idle, setIdle] = useState(false)
  const listenMpvPointer = opts?.listenMpvPointer === true

  useEffect(() => {
    if (!enabled) {
      setIdle(false)
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    const arm = (): void => {
      if (timer != null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        setIdle(true)
      }, idleMs)
    }

    const onActivity = (): void => {
      setIdle(false)
      arm()
    }

    arm()
    window.addEventListener('pointermove', onActivity, true)
    window.addEventListener('pointerdown', onActivity, true)
    window.addEventListener('wheel', onActivity, true)
    const offMpv = listenMpvPointer
      ? api.onEvent((event) => {
          if (event.type === 'preview-mpv-pointer') onActivity()
        })
      : null
    return () => {
      if (timer != null) clearTimeout(timer)
      window.removeEventListener('pointermove', onActivity, true)
      window.removeEventListener('pointerdown', onActivity, true)
      window.removeEventListener('wheel', onActivity, true)
      offMpv?.()
    }
  }, [enabled, idleMs, listenMpvPointer])

  return idle
}
