// ============================================================================
// NATIVE LINUX WAYLAND PRIVILEGE INITIALIZATION
// This executes inside the memory block before Electron mounts the storage layers
// ============================================================================
if (process.platform === 'linux') {
  process.env['AT_SPI_BUS_ADDRESS'] = 'unix:path=/dev/null'
  process.env['NO_AT_BRIDGE'] = '1'
  process.env['GTK_MODULES'] = ''
  process.env['ELECTRON_DISABLE_SANDBOX'] = '1'
}

import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import appIcon from '../../resources/icon.png?asset'
import { registerMediaSchemeAsPrivileged, registerMediaProtocolHandler } from './media/protocol'
import { registerOrtProtocolHandler } from './media/ortProtocol'
import { registerModelProtocolHandler } from './media/modelProtocol'
import { registerIpcHandlers } from './ipc/register'
import { broadcast } from './ipc/events'
import { loadWindowState, trackWindowState } from './windowState'
import { sessionStore } from './session/store'
import { settingsStore } from './settings/store'
import { thumbCacheDir } from './thumbs'
import { shellIconCacheDir } from './icons/shell'
import { ensureTabIconsDir } from './tabs/customIcon'
import { logMain } from './logging'
import { dispatchFromArgv, focusMainWindow, setMainWindow } from './externalOpen'
import { closeCompiledListsWindow } from './slideshow/compiledListsWindow'
import { closePreviewWindow } from './preview/previewWindow'
import { configureUserData } from './userData'
import { parseUsnRecentCli, runUsnRecentCli } from './fs/usnRecentCli'

// ============================================================================
// SAFELY ISOLATE CRASHING WINDOWS INITIALIZATIONS ON LINUX
// ============================================================================
if (process.platform === 'win32') {
  configureUserData()
} else {
  // Safe default directory layout for Linux to bypass internal storage process drops
  const defaultLinuxPath = path.join(app.getPath('appData'), 'MyFileExplorer')
  try {
    fs.mkdirSync(defaultLinuxPath, { recursive: true })
  } catch {
    // Fail silently if directory exists or permissions alter
  }
  app.setPath('userData', defaultLinuxPath)
}

// Elevated helper: dump recent USN records and exit (must skip single-instance lock).
if (process.platform === 'win32' && process.argv.includes('--usn-recent')) {
  const usnRecentCli = parseUsnRecentCli(process.argv)
  if (!usnRecentCli) process.exit(1)
  process.exit(runUsnRecentCli(usnRecentCli.letter, usnRecentCli.outFile))
}

// Single instance: later launches forward their argv to this process and quit.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // Must run before ready. Reads settings.json synchronously.
  try {
    // Isolate hardware acceleration setting checking safely to Windows environments
    if (process.platform === 'win32' && settingsStore().get().disableHardwareAcceleration) {
      app.disableHardwareAcceleration()
      logMain('info', 'Hardware acceleration disabled (settings)')
    }
  } catch (e) {
    logMain(
      'warn',
      `Could not apply hardware-acceleration setting: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  // Only register Windows-specific scheme states
  if (process.platform === 'win32') {
    registerMediaSchemeAsPrivileged()
  }

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
    setMainWindow(win)
    // Compiled lists is a child of the shell — closing main must not leave it dangling.
    win.on('close', () => {
      closeCompiledListsWindow()
      closePreviewWindow()
    })

    // Font size is app-controlled (Ctrl+wheel / Settings); block Chromium page zoom.
    void win.webContents.setVisualZoomLevelLimits(1, 1)

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
    // Mouse Back / Forward buttons (Windows) → in-app tab history, not webContents.
    // Electron typings omit `app-command` on some versions; cast the emitter.
    ;(win.webContents as Electron.WebContents & {
      on(
        event: 'app-command',
        listener: (event: Electron.Event, cmd: string) => void
      ): Electron.WebContents
    }).on('app-command', (_e, cmd) => {
      if (cmd === 'browser-backward') {
        broadcast({ type: 'history-nav', payload: { dir: 'back' } })
      } else if (cmd === 'browser-forward') {
        broadcast({ type: 'history-nav', payload: { dir: 'forward' } })
      }
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
    ensureTabIconsDir()
    void import('./search').then((m) => {
      m.initSearchIndexRuntime()
      void import('./search/httpServer').then((h) => h.syncSearchHttpServer())
    })
    createMainWindow()

    // Cold start with a path / protocol URL on the command line.
    dispatchFromArgv(process.argv)

    void import('./update/installers').then((m) => m.cleanupStaleUpdateTemps())

    // Best-effort: migrate AppData image-originals → on-file VER_* ADS (D27).
    void import('./fs/imageEdit')
      .then((m) => m.migrateImageOriginalsToAds())
      .then((r) => {
        if (r.migrated > 0 || r.failed > 0) {
          logMain(
            'info',
            `image-originals migrate: migrated=${r.migrated} skipped=${r.skipped} failed=${r.failed}`
          )
        }
      })
      .catch((e) => {
        logMain(
          'warn',
          `image-originals migrate failed: ${e instanceof Error ? e.message : String(e)}`
        )
      })

    logMain('info', `MyFileExplorer started (userData: ${app.getPath('userData')})`)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('before-quit', () => {
    sessionStore().flush()
    settingsStore().flush()
    void import('./fs/network').then((m) => m.disposeNetworkDiscovery())
    void import('./search').then((m) => m.shutdownSearchIndexRuntime())
    void import('./search/httpServer').then((h) => h.stopSearchHttpServer())
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
