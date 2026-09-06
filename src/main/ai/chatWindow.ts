/**
 * Detached Ask AI chat BrowserWindow — peer of the explorer (no parent),
 * so it can move/maximize on another display like Preview / Properties.
 */
import path from 'node:path'
import { BrowserWindow, screen } from 'electron'
import appIcon from '../../../resources/icon.png?asset'
import { patchSettings, settingsStore } from '../settings/store'
import { broadcast } from '../ipc/events'
import { logMain } from '../logging'

let chatWin: BrowserWindow | null = null

function defaultBounds(): { x: number; y: number; width: number; height: number } {
  const wa = screen.getPrimaryDisplay().workArea
  const width = Math.min(1100, Math.max(720, Math.floor(wa.width * 0.7)))
  const height = Math.min(800, Math.max(520, Math.floor(wa.height * 0.75)))
  return {
    x: wa.x + Math.max(0, Math.floor((wa.width - width) / 2)),
    y: wa.y + Math.max(0, Math.floor((wa.height - height) / 2)),
    width,
    height
  }
}

function clampOntoDisplay(saved: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } {
  const width = Math.max(640, saved.width)
  const height = Math.max(480, saved.height)
  const onScreen = screen.getAllDisplays().some((d) => {
    const b = d.workArea
    return (
      saved.x >= b.x - 50 &&
      saved.y >= b.y - 50 &&
      saved.x < b.x + b.width &&
      saved.y < b.y + b.height
    )
  })
  if (!onScreen) {
    const fallback = defaultBounds()
    return {
      ...fallback,
      width: Math.min(width, fallback.width),
      height: Math.min(height, fallback.height)
    }
  }
  return { x: saved.x, y: saved.y, width, height }
}

function persistBounds(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMinimized()) return
  const maximized = win.isMaximized()
  const b = maximized ? win.getNormalBounds() : win.getBounds()
  try {
    patchSettings({
      aiChatWindowBounds: {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        maximized
      }
    })
  } catch (e) {
    logMain(
      'warn',
      `persist Ask AI window bounds: ${e instanceof Error ? e.message : String(e)}`
    )
  }
}

export function openAiChatWindow(opts?: {
  conversationId?: string
  topicId?: string
}): { opened: true } {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.focus()
    if (opts?.conversationId) focusAiChatConversation(opts.conversationId)
    return { opened: true }
  }

  const saved = settingsStore().get().aiChatWindowBounds
  const bounds = saved ? clampOntoDisplay(saved) : defaultBounds()

  chatWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 640,
    minHeight: 480,
    show: false,
    icon: appIcon,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    title: 'Ask AI',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const win = chatWin
  win.once('ready-to-show', () => {
    if (saved?.maximized) win.maximize()
    win.show()
    if (opts?.conversationId) focusAiChatConversation(opts.conversationId)
  })
  win.on('resize', () => persistBounds(win))
  win.on('move', () => persistBounds(win))
  win.on('maximize', () => persistBounds(win))
  win.on('unmaximize', () => persistBounds(win))
  win.on('close', () => persistBounds(win))
  win.on('closed', () => {
    if (chatWin === win) chatWin = null
  })

  void win.webContents.setVisualZoomLevelLimits(1, 1)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/aiChatWindow.html`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/aiChatWindow.html'))
  }

  return { opened: true }
}

export function focusAiChatConversation(conversationId: string): void {
  broadcast({
    type: 'ai-chat-focus',
    payload: { conversationId }
  })
}

export function getAiChatWindow(): BrowserWindow | null {
  return chatWin && !chatWin.isDestroyed() ? chatWin : null
}

export function closeAiChatWindow(): { closed: boolean } {
  if (!chatWin || chatWin.isDestroyed()) return { closed: false }
  const win = chatWin
  chatWin = null
  win.close()
  return { closed: true }
}
