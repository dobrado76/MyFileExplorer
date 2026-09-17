import fs from 'node:fs'
import { BrowserWindow } from 'electron'
import appIcon from '../../resources/icon.png?asset'
import { logMain } from './logging'

let splash: BrowserWindow | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null

function splashHtml(version: string): string {
  let iconData = ''
  try {
    iconData = `data:image/png;base64,${fs.readFileSync(appIcon).toString('base64')}`
  } catch {
    /* brand text only */
  }
  const iconBlock = iconData
    ? `<img class="icon" src="${iconData}" width="88" height="88" alt="" />`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"
  />
  <title>MyFileExplorer</title>
  <style>
    html, body {
      margin: 0;
      height: 100%;
      overflow: hidden;
      background: #12141a;
      color: #e8eaef;
      font-family: "Segoe UI", system-ui, sans-serif;
      user-select: none;
      -webkit-app-region: drag;
    }
    .wrap {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      box-sizing: border-box;
      padding: 28px 24px 32px;
    }
    .icon {
      display: block;
      border-radius: 18px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    }
    .name {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .status {
      font-size: 13px;
      color: #9aa3b5;
      letter-spacing: 0.02em;
      animation: pulse 1.4s ease-in-out infinite;
    }
    .ver {
      font-size: 11px;
      color: #6b7385;
      margin-top: 2px;
    }
    @keyframes pulse {
      0%, 100% { opacity: 0.55; }
      50% { opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    ${iconBlock}
    <div class="name">MyFileExplorer</div>
    <div class="status">Starting…</div>
    <div class="ver">${escapeHtml(version)}</div>
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Small frameless window shown until the main shell is ready to show. */
export function showSplash(version: string): void {
  if (splash && !splash.isDestroyed()) return
  const win = new BrowserWindow({
    width: 360,
    height: 260,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: false,
    transparent: false,
    show: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  splash = win
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  win.on('closed', () => {
    if (splash === win) splash = null
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(version))}`)
  // Safety: never leave a stuck splash if main never becomes ready.
  closeTimer = setTimeout(() => closeSplash(), 45_000)
}

export function closeSplash(): void {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  const win = splash
  splash = null
  if (!win || win.isDestroyed()) return
  try {
    win.close()
  } catch (e) {
    logMain('warn', `splash close failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
