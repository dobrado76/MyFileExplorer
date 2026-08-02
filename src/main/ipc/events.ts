import { BrowserWindow } from 'electron'
import { EVENT_CHANNEL, type MfeEvent } from '@shared/ipc/contract'

export function broadcast(event: MfeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event)
  }
}
