import path from 'node:path'
import dns from 'node:dns/promises'
import { app } from 'electron'
import { z } from 'zod'
import { networkHostSchema, type NetworkHost } from '@shared/schemas/network'
import {
  collapseHostIpAliases,
  displayHostLabel,
  hostUnc,
  isIpv4Literal,
  normalizeServerName,
  preferHostLabel
} from '@shared/networkPaths'
import { JsonStore } from '../store/jsonStore'

const MAX_REMEMBERED = 64

const rememberedNetworkSchema = z.object({
  hosts: z.array(networkHostSchema).max(MAX_REMEMBERED).default([]),
  updatedAtMs: z.number().int().nonnegative().default(0)
})

export type RememberedNetwork = z.infer<typeof rememberedNetworkSchema>

const emptyRemembered: RememberedNetwork = { hosts: [], updatedAtMs: 0 }

let store: JsonStore<RememberedNetwork> | null = null
let collapseTimer: NodeJS.Timeout | null = null

function rememberedStore(): JsonStore<RememberedNetwork> {
  if (!store) {
    store = new JsonStore(
      path.join(app.getPath('userData'), 'network-hosts.json'),
      rememberedNetworkSchema,
      emptyRemembered,
      300
    )
  }
  return store
}

function normalizeHost(raw: NetworkHost | string): NetworkHost | null {
  const name =
    typeof raw === 'string' ? normalizeServerName(raw) : normalizeServerName(raw.name || raw.unc)
  if (!name) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name)) return null
  const label = displayHostLabel(name)
  return { name: label, unc: hostUnc(label) }
}

function saveHosts(hosts: NetworkHost[]): NetworkHost[] {
  const next = hosts
    .map((h) => normalizeHost(h))
    .filter((h): h is NetworkHost => !!h)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .slice(0, MAX_REMEMBERED)
  rememberedStore().replace({ hosts: next, updatedAtMs: Date.now() })
  rememberedStore().flush()
  return next
}

/** Hosts shown immediately on next launch (no rediscovery wait). */
export function getRememberedNetworkHosts(): NetworkHost[] {
  const parsed = rememberedNetworkSchema.parse(rememberedStore().get())
  return parsed.hosts.map((h) => normalizeHost(h)).filter((h): h is NetworkHost => !!h)
}

/** Replace the remembered list (settings import). */
export function replaceRememberedNetworkHosts(hosts: Array<NetworkHost | string>): NetworkHost[] {
  const normalized = hosts
    .map((h) => normalizeHost(h))
    .filter((h): h is NetworkHost => !!h)
  return saveHosts(normalized)
}

/** Merge hosts into the remembered list (hostname + nicer casing win). */
export function rememberNetworkHosts(hosts: Array<NetworkHost | string>): NetworkHost[] {
  const byKey = new Map<string, NetworkHost>()
  for (const h of getRememberedNetworkHosts()) {
    const n = normalizeHost(h)
    if (n) byKey.set(n.name.toLowerCase(), n)
  }
  for (const h of hosts) {
    const n = normalizeHost(h)
    if (!n) continue
    const key = n.name.toLowerCase()
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, n)
      continue
    }
    const preferred = displayHostLabel(preferHostLabel(prev.name, n.name))
    byKey.set(key, { name: preferred, unc: hostUnc(preferred) })
  }
  // Drop raw IPs when a same-key hostname already exists (sync pass).
  for (const [key, h] of [...byKey.entries()]) {
    if (isIpv4Literal(h.name)) continue
    // nothing — IP keys differ from hostname keys; DNS collapse is async below
    void key
  }
  const next = saveHosts([...byKey.values()])
  scheduleCollapseAliases()
  return next
}

export function rememberNetworkHost(server: string): void {
  rememberNetworkHosts([server])
}

async function collapseRememberedAliases(): Promise<void> {
  const hosts = getRememberedNetworkHosts()
  const ipv4ToHostname = new Map<string, string>()
  for (const h of hosts) {
    const name = normalizeServerName(h.name)
    if (!name) continue
    if (isIpv4Literal(name)) {
      try {
        const names = await dns.reverse(name)
        const rev = names[0] ? normalizeServerName(names[0].split('.')[0] ?? names[0]) : ''
        if (rev) ipv4ToHostname.set(name.toLowerCase(), displayHostLabel(rev))
      } catch {
        /* offline / no PTR */
      }
      continue
    }
    try {
      const ips = await dns.lookup(name, { all: true, family: 4 })
      for (const a of ips) ipv4ToHostname.set(a.address.toLowerCase(), displayHostLabel(name))
    } catch {
      /* ignore */
    }
  }
  const collapsed = collapseHostIpAliases(hosts, ipv4ToHostname).map((h) => ({
    name: displayHostLabel(h.name),
    unc: hostUnc(displayHostLabel(h.name))
  }))
  saveHosts(collapsed)
}

function scheduleCollapseAliases(): void {
  if (collapseTimer) clearTimeout(collapseTimer)
  collapseTimer = setTimeout(() => {
    collapseTimer = null
    void collapseRememberedAliases()
  }, 250)
}

export function flushRememberedNetworkHosts(): void {
  rememberedStore().flush()
}
