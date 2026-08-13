/**
 * LAN neighborhood facade — Win32 implementation lives in `networkWin32.ts` (lazy).
 */
import { AppError } from '@shared/result'
import type { NetworkShare } from '@shared/schemas/network'
import { broadcast } from '../ipc/events'
import { getSettings } from '../settings/store'
import { flushRememberedNetworkHosts } from './networkRemembered'

export {
  localComputerDisplayName,
  localComputerNames,
  toNetworkHost
} from './networkShared'

type NetworkWin32 = typeof import('./networkWin32')

let win32Mod: NetworkWin32 | null = null
let win32Load: Promise<NetworkWin32 | null> | null = null
let stubGeneration = 0

async function loadWin32(): Promise<NetworkWin32 | null> {
  if (process.platform !== 'win32') return null
  if (win32Mod) return win32Mod
  if (!win32Load) {
    win32Load = import('./networkWin32')
      .then((m) => {
        win32Mod = m
        return m
      })
      .catch(() => null)
  }
  return win32Load
}

function discoveryDisabled(): { generation: number } {
  const generation = ++stubGeneration
  broadcast({
    type: 'network-discovery',
    payload: { generation, status: 'done', hosts: [] }
  })
  return { generation }
}

export async function openMapNetworkDriveDialog(): Promise<{ opened: boolean; result: number }> {
  const mod = await loadWin32()
  if (!mod) throw new AppError('io', 'Map network drive is only available on Windows')
  return mod.openMapNetworkDriveDialog()
}

export async function openDisconnectNetworkDriveDialog(): Promise<{
  opened: boolean
  result: number
}> {
  const mod = await loadWin32()
  if (!mod) throw new AppError('io', 'Disconnect network drive is only available on Windows')
  return mod.openDisconnectNetworkDriveDialog()
}

export async function listNetworkShares(serverRaw: string): Promise<NetworkShare[]> {
  const mod = await loadWin32()
  if (!mod) throw new AppError('io', 'Network shares are only available on Windows')
  return mod.listNetworkShares(serverRaw)
}

export async function startNetworkDiscovery(): Promise<{ generation: number }> {
  if (getSettings().networkDiscovery.enabled === false) {
    if (process.platform === 'win32') {
      const mod = await loadWin32()
      if (mod) return mod.startNetworkDiscovery()
    }
    return discoveryDisabled()
  }
  if (process.platform !== 'win32') return discoveryDisabled()
  const mod = await loadWin32()
  if (!mod) return discoveryDisabled()
  return mod.startNetworkDiscovery()
}

export async function cancelNetworkDiscovery(): Promise<{ cancelled: boolean }> {
  if (process.platform !== 'win32') return { cancelled: false }
  const mod = await loadWin32()
  if (!mod) return { cancelled: false }
  return mod.cancelNetworkDiscovery()
}

export async function disposeNetworkDiscovery(): Promise<void> {
  if (process.platform === 'win32') {
    const mod = await loadWin32()
    mod?.disposeNetworkDiscovery()
  }
  flushRememberedNetworkHosts()
}
