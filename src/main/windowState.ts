import path from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { z } from 'zod'
import { JsonStore } from './store/jsonStore'

const windowStateSchema = z.object({
  x: z.number().nullable().catch(null),
  y: z.number().nullable().catch(null),
  width: z.number().min(400).catch(1400),
  height: z.number().min(300).catch(900),
  isMaximized: z.boolean().catch(false)
})
type WindowState = z.infer<typeof windowStateSchema>

const fallback: WindowState = { x: null, y: null, width: 1400, height: 900, isMaximized: false }

let store: JsonStore<WindowState> | null = null

function windowStateStore(): JsonStore<WindowState> {
  if (!store) {
    store = new JsonStore(
      path.join(app.getPath('userData'), 'window-state.json'),
      windowStateSchema,
      fallback
    )
  }
  return store
}

export function loadWindowState(): WindowState {
  const state = windowStateStore().get()
  // Keep window on a visible display.
  if (state.x !== null && state.y !== null) {
    const onScreen = screen.getAllDisplays().some((d) => {
      const b = d.workArea
      return (
        state.x! >= b.x - 50 &&
        state.y! >= b.y - 50 &&
        state.x! < b.x + b.width &&
        state.y! < b.y + b.height
      )
    })
    if (!onScreen) return { ...state, x: null, y: null }
  }
  return state
}

export function trackWindowState(win: BrowserWindow): void {
  const save = (): void => {
    if (win.isDestroyed()) return
    // A minimized window reports bogus bounds (-32000 on Windows); keep the last good state.
    if (win.isMinimized()) return
    const isMaximized = win.isMaximized()
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds()
    windowStateStore().set({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized
    })
  }
  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', () => {
    save()
    windowStateStore().flush()
  })
}
