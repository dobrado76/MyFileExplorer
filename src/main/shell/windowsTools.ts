/**
 * Open classic Windows This PC tools (Computer Management, Device Manager,
 * Control Panel, This PC Properties). Real system windows — not in-app UI.
 */
import path from 'node:path'
import { AppError } from '@shared/result'
import type { WindowsToolId } from '@shared/schemas/windowsTools'
import { shellExecuteOpen } from './openCommandLine'
import { invokeIdListVerb, THIS_PC_CLSID } from './showProperties'

export function windowsSystem32File(name: string): string {
  const root = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  return path.join(root, 'system32', name)
}

function tryThisPcVerb(verb: string): boolean {
  try {
    return invokeIdListVerb(THIS_PC_CLSID, verb)
  } catch {
    return false
  }
}

export function openWindowsTool(id: WindowsToolId): { opened: true } {
  if (process.platform !== 'win32') {
    throw new AppError('not-allowed', 'This Windows tool is only available on Windows')
  }
  switch (id) {
    case 'computer-manager':
      if (tryThisPcVerb('manage')) return { opened: true }
      if (shellExecuteOpen(windowsSystem32File('CompMgmtLauncher.exe'))) return { opened: true }
      if (shellExecuteOpen(windowsSystem32File('compmgmt.msc'))) return { opened: true }
      throw new AppError('io', 'Could not open Computer Management')
    case 'device-manager':
      if (shellExecuteOpen(windowsSystem32File('devmgmt.msc'))) return { opened: true }
      if (shellExecuteOpen(windowsSystem32File('mmc.exe'), windowsSystem32File('devmgmt.msc'))) {
        return { opened: true }
      }
      throw new AppError('io', 'Could not open Device Manager')
    case 'control-panel':
      if (shellExecuteOpen(windowsSystem32File('control.exe'))) return { opened: true }
      throw new AppError('io', 'Could not open Control Panel')
    case 'this-pc-properties':
      if (tryThisPcVerb('properties')) return { opened: true }
      if (shellExecuteOpen('ms-settings:about')) return { opened: true }
      if (shellExecuteOpen(windowsSystem32File('sysdm.cpl'))) return { opened: true }
      throw new AppError('io', 'Could not open This PC Properties')
  }
}
