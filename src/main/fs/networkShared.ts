import os from 'node:os'
import type { NetworkHost } from '@shared/schemas/network'
import {
  displayHostLabel,
  filterOutLocalNetworkHosts,
  hostUnc,
  normalizeServerName
} from '@shared/networkPaths'
import { getSettings } from '../settings/store'

/** This PC’s host names — used to hide/show the local computer in Network. */
export function localComputerNames(): string[] {
  const out: string[] = []
  try {
    const hn = os.hostname()
    if (hn) out.push(hn)
  } catch {
    /* ignore */
  }
  if (process.env.COMPUTERNAME) out.push(process.env.COMPUTERNAME)
  return out
}

/** Display label for Settings → Network (NetBIOS-style when possible). */
export function localComputerDisplayName(): string {
  const names = localComputerNames()
  const preferred =
    names.find((n) => n === process.env.COMPUTERNAME) ?? names[0] ?? ''
  return preferred ? displayHostLabel(preferred) : ''
}

export function hostsForNetworkTree(hosts: NetworkHost[]): NetworkHost[] {
  if (getSettings().networkDiscovery.showLocalComputer) return [...hosts]
  return filterOutLocalNetworkHosts(hosts, localComputerNames())
}

/** Build a host entry from a NetBIOS / DNS name. */
export function toNetworkHost(name: string): NetworkHost | null {
  const n = normalizeServerName(name)
  if (!n) return null
  return { name: n, unc: hostUnc(n) }
}
