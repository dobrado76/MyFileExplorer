import path from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import appIcon from '../../resources/icon.png?asset'
import { registerMediaSchemeAsPrivileged, registerMediaProtocolHandler } from './media/protocol'
import { registerOrtProtocolHandler } from './media/ortProtocol'
import { registerModelProtocolHandler } from './media/modelProtocol'
import { registerIpcHandlers } from './ipc/register'
import { loadWindowState, trackWindowState } from './windowState'
import { sessionStore } from './session/store'
import { settingsStore } from './settings/store'
import { thumbCacheDir } from './thumbs'
import { shellIconCacheDir } from './icons/shell'
import { logMain } from './logging'
import { dispatchFromArgv, focusMainWindow } from './externalOpen'
import { configureUserData } from './userData'

// Shared %APPDATA%\MyFileExplorer for npm run dev and installed builds (before lock/stores).
configureUserData()

// Single instance: later launches forward their argv to this process and quit.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  registerMediaSchemeAsPrivileged()

  function createMainWindow(): void {
    const state = loadWindowState()
    const win = new BrowserWindow({
      x: state.x ?? undefined,
      y: state.y ?? undefined,
      width: state.width,
      height: state.height,
      minWidth: 640,
      minHeight: 400,
      show: false,
      icon: appIcon,
      autoHideMenuBar: true,
      backgroundColor: '#12141a',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    trackWindowState(win)

    win.once('ready-to-show', () => {
      if (state.isMaximized) win.maximize()
      win.show()
    })

    // Never navigate the shell window; open external links via OS browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (e, url) => {
      if (
        process.env['ELECTRON_RENDERER_URL'] &&
        url.startsWith(process.env['ELECTRON_RENDERER_URL'])
      ) {
        return
      }
      e.preventDefault()
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      void win.loadFile(path.join(__dirname, '../renderer/index.html'))
    }
  }

  app.on('second-instance', (_event, argv) => {
    focusMainWindow()
    dispatchFromArgv(argv)
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    focusMainWindow()
    dispatchFromArgv(['app', url])
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.myfileexplorer.app')

    // Register mfe:// for deep links from other apps.
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('mfe', process.execPath, [
          path.resolve(process.argv[1]!)
        ])
      }
    } else {
      app.setAsDefaultProtocolClient('mfe')
    }

    registerMediaProtocolHandler()
    registerOrtProtocolHandler()
    registerModelProtocolHandler()
    registerIpcHandlers()
    thumbCacheDir()
    shellIconCacheDir()
    createMainWindow()

    // Cold start with a path / protocol URL on the command line.
    dispatchFromArgv(process.argv)

    logMain('info', `MyFileExplorer started (userData: ${app.getPath('userData')})`)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('before-quit', () => {
    sessionStore().flush()
    settingsStore().flush()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
