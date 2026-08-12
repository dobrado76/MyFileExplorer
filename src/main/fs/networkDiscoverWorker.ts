/**
 * Worker thread: discover LAN SMB hosts without blocking Electron main.
 *
 * Order (fast → slow):
 * 1. Probe remembered hosts (TCP 445 + NetShareEnum) — only reachable ones enter the list
 * 2. Shell Network names + ARP neighbors in parallel (445 gate before share enum)
 *
 * Dedupes IP vs hostname aliases; prefers Shell/NetBIOS casing (NEWONYX over newonyx).
 * Offline remembered names are never seeded into progress/done (unlike mapped drives).
 *
 * Messages in: { type: 'discover', generation, remembered?: NetworkHost[] } | { type: 'cancel', generation }
 * Messages out: progress | done | error
 */
import { parentPort } from 'node:worker_threads'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import dns from 'node:dns/promises'
import net from 'node:net'
import os from 'node:os'
import koffi from 'koffi'
import {
  collapseHostIpAliases,
  displayHostLabel,
  hostUnc,
  isIpv4Literal,
  preferHostLabel
} from '../../shared/networkPaths'

const execFileAsync = promisify(execFile)

type NetworkHost = { name: string; unc: string }

const STYPE_DISKTREE = 0
const MAX_NEIGHBOR_PROBES = 32
const SHARE_PROBE_CONCURRENCY = 8
const TCP_445_MS = 450
const DISCOVERY_BUDGET_MS = 20_000

let cancelledGeneration = -1

function normalizeServerName(raw: string): string {
  let s = raw.trim().replace(/\//g, '\\')
  if (s.startsWith('\\\\')) s = s.slice(2)
  const slash = s.indexOf('\\')
  if (slash >= 0) s = s.slice(0, slash)
  return s.replace(/\.+$/, '').trim()
}

function isCancelled(generation: number): boolean {
  return generation <= cancelledGeneration
}

/** Only skip our own NIC addresses from ARP (local hostname is filtered in main). */
function localIpv4Keys(): Set<string> {
  const keys = new Set<string>()
  try {
    const ifs = os.networkInterfaces()
    for (const list of Object.values(ifs)) {
      if (!list) continue
      for (const a of list) {
        if (a.family === 'IPv4' && a.address) keys.add(a.address.toLowerCase())
      }
    }
  } catch {
    /* ignore */
  }
  return keys
}

function upsertHost(map: Map<string, NetworkHost>, raw: string): void {
  const name = displayHostLabel(normalizeServerName(raw))
  if (!name) return
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(name)) return
  const key = name.toLowerCase()
  const prev = map.get(key)
  if (!prev) {
    map.set(key, { name, unc: hostUnc(name) })
    return
  }
  const preferred = preferHostLabel(prev.name, name)
  const label = displayHostLabel(preferred)
  map.set(key, { name: label, unc: hostUnc(label) })
}

let shareApi: {
  NetShareEnum: (
    server: string | null,
    level: number,
    bufptr: unknown[],
    prefmaxlen: number,
    entriesread: number[],
    totalentries: number[],
    resume: number[]
  ) => number
  NetApiBufferFree: (buf: unknown) => number
  ShareInfo1: ReturnType<typeof koffi.struct>
} | null | undefined

function ensureShareApi(): NonNullable<typeof shareApi> | null {
  if (shareApi !== undefined) return shareApi
  if (process.platform !== 'win32') {
    shareApi = null
    return null
  }
  const netapi32 = koffi.load('netapi32.dll')
  const ShareInfo1 = koffi.struct('MfeWorkerSHARE_INFO_1', {
    shi1_netname: 'str16',
    shi1_type: 'uint32',
    shi1_remark: 'str16'
  })
  shareApi = {
    ShareInfo1,
    NetShareEnum: netapi32.func(
      'uint32 __stdcall NetShareEnum(str16 servername, uint32 level, _Out_ void **bufptr, uint32 prefmaxlen, _Out_ uint32 *entriesread, _Out_ uint32 *totalentries, _Inout_ uint32 *resume_handle)'
    ),
    NetApiBufferFree: netapi32.func('uint32 __stdcall NetApiBufferFree(void *Buffer)')
  }
  return shareApi
}

function tcpPortOpen(host: string, port: number, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, ms)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

async function ipv4Targets(host: string): Promise<string[]> {
  if (isIpv4Literal(host)) return [host]
  try {
    const all = await dns.lookup(host, { all: true, family: 4 })
    return [...new Set(all.map((a) => a.address))]
  } catch {
    return []
  }
}

async function smbPortLikelyOpen(host: string): Promise<boolean> {
  const ips = await ipv4Targets(host)
  if (ips.length === 0) return !isIpv4Literal(host)
  for (const ip of ips) {
    if (await tcpPortOpen(ip, 445, TCP_445_MS)) return true
  }
  return false
}

function hasDiskShares(serverRaw: string): boolean {
  const api = ensureShareApi()
  if (!api) return false
  const server = normalizeServerName(serverRaw)
  if (!server) return false
  const bufptr: unknown[] = [null]
  const entriesread = [0]
  const totalentries = [0]
  const resume = [0]
  let status = 1
  try {
    status = api.NetShareEnum(server, 1, bufptr, 0xffffffff, entriesread, totalentries, resume)
  } catch {
    return false
  }
  if (status !== 0 && status !== 234) return false
  const base = bufptr[0]
  const count = entriesread[0] ?? 0
  try {
    if (!base || count <= 0) return false
    const sizeof = koffi.sizeof(api.ShareInfo1)
    for (let i = 0; i < count; i++) {
      const row = koffi.decode(base as never, i * sizeof, api.ShareInfo1) as {
        shi1_netname: string
        shi1_type: number
      }
      const name = String(row.shi1_netname ?? '').trim()
      if (!name || name.endsWith('$')) continue
      if (((row.shi1_type >>> 0) & 0x0fffffff) === STYPE_DISKTREE) return true
    }
    return false
  } finally {
    if (base) {
      try {
        api.NetApiBufferFree(base)
      } catch {
        /* ignore */
      }
    }
  }
}

async function hostHasSharesFast(server: string): Promise<boolean> {
  if (!(await smbPortLikelyOpen(server))) return false
  return hasDiskShares(server)
}

async function enumerateViaShellNetwork(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$sh=New-Object -ComObject Shell.Application",
    "$f=$sh.NameSpace(18)",
    "if(-not $f){ exit 0 }",
    "foreach($i in @($f.Items())){ if($i.Name){ $i.Name } }"
  ].join('; ')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 12_000, encoding: 'utf8', maxBuffer: 2_000_000 }
    )
    const names: string[] = []
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // Keep original casing from the first token ("NEWONYX: user@…").
      const m = /^([A-Za-z0-9][A-Za-z0-9_-]{0,62})\b/.exec(trimmed)
      if (m) names.push(m[1]!)
    }
    return names
  } catch {
    return []
  }
}

function parseArpIpv4(stdout: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+/i.exec(line)
    if (!m) continue
    const ip = m[1]!
    const parts = ip.split('.').map((x) => Number(x))
    if (parts.length !== 4 || parts.some((n) => n > 255)) continue
    if (parts[0] === 224 || parts[0] === 239) continue
    if (parts[0] === 169 && parts[1] === 254) continue
    if (parts[3] === 255 || parts[3] === 0) continue
    if (ip.startsWith('127.')) continue
    const key = ip.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ip)
  }
  return out
}

async function enumerateArpIpv4(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await execFileAsync('arp.exe', ['-a'], {
      windowsHide: true,
      timeout: 5_000,
      encoding: 'utf8',
      maxBuffer: 2_000_000
    })
    return parseArpIpv4(stdout)
  } catch {
    return []
  }
}

async function reverseDnsName(ip: string): Promise<string | null> {
  try {
    const names = await dns.reverse(ip)
    const n = names[0] ? normalizeServerName(names[0].split('.')[0] ?? names[0]) : ''
    return n || null
  } catch {
    return null
  }
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  shouldStop?: () => boolean
): Promise<void> {
  let i = 0
  async function worker(): Promise<void> {
    for (;;) {
      if (shouldStop?.()) return
      const idx = i++
      if (idx >= items.length) return
      await fn(items[idx]!)
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1))
  await Promise.all(Array.from({ length: n }, () => worker()))
}

/** Map each IPv4 entry to a hostname when DNS knows one; also forward-resolve names. */
async function buildIpAliasMap(hosts: NetworkHost[]): Promise<Map<string, string>> {
  const ipv4ToHostname = new Map<string, string>()
  for (const h of hosts) {
    const name = normalizeServerName(h.name)
    if (!name) continue
    if (isIpv4Literal(name)) {
      const rev = await reverseDnsName(name)
      if (rev) ipv4ToHostname.set(name.toLowerCase(), displayHostLabel(rev))
      continue
    }
    try {
      const ips = await dns.lookup(name, { all: true, family: 4 })
      for (const a of ips) {
        ipv4ToHostname.set(a.address.toLowerCase(), displayHostLabel(name))
      }
    } catch {
      /* ignore */
    }
  }
  return ipv4ToHostname
}

async function collapsedHosts(map: Map<string, NetworkHost>): Promise<NetworkHost[]> {
  const list = [...map.values()]
  const aliases = await buildIpAliasMap(list)
  const collapsed = collapseHostIpAliases(list, aliases)
  // Rebuild map so later upserts stay deduped.
  map.clear()
  for (const h of collapsed) {
    const label = displayHostLabel(h.name)
    map.set(label.toLowerCase(), { name: label, unc: hostUnc(label) })
  }
  return [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}

async function emitProgress(generation: number, map: Map<string, NetworkHost>): Promise<void> {
  const hosts = await collapsedHosts(map)
  parentPort?.postMessage({ type: 'progress', generation, hosts })
}

async function discoverHosts(
  generation: number,
  remembered: NetworkHost[]
): Promise<NetworkHost[]> {
  const byKey = new Map<string, NetworkHost>()
  const skipIps = localIpv4Keys()
  const started = Date.now()
  const overBudget = (): boolean => Date.now() - started > DISCOVERY_BUDGET_MS

  // Remembered names are probe targets only — do not list offline PCs (unlike mapped drives).
  const rememberedNames = [
    ...new Set(
      remembered
        .map((h) => normalizeServerName(h.name || h.unc))
        .filter((n) => n && !(isIpv4Literal(n) && skipIps.has(n.toLowerCase())))
    )
  ]
  await mapPool(
    rememberedNames,
    SHARE_PROBE_CONCURRENCY,
    async (name) => {
      if (isCancelled(generation)) return
      if (await hostHasSharesFast(name)) {
        upsertHost(byKey, name)
        await emitProgress(generation, byKey)
      }
    },
    () => isCancelled(generation)
  )
  if (isCancelled(generation)) return collapsedHosts(byKey)
  await emitProgress(generation, byKey)

  const shellPromise = enumerateViaShellNetwork()
  const arpPromise = enumerateArpIpv4()

  const probeNew = async (label: string, preferredName?: string): Promise<void> => {
    if (isCancelled(generation) || overBudget()) return
    const key = label.toLowerCase()
    if (isIpv4Literal(label) && skipIps.has(key)) return
    // Already have this hostname (non-IP).
    if (!isIpv4Literal(label) && byKey.has(key)) {
      if (preferredName) upsertHost(byKey, preferredName)
      return
    }
    if (!(await hostHasSharesFast(label))) return
    let display = preferredName ?? label
    if (isIpv4Literal(label) && !preferredName) {
      display = (await reverseDnsName(label)) ?? label
    }
    upsertHost(byKey, display)
    // If we added via IP but also know a nicer name, alias-collapse on emit.
    await emitProgress(generation, byKey)
  }

  const arpTask = (async () => {
    const ips = (await arpPromise)
      .filter((ip) => !skipIps.has(ip.toLowerCase()))
      .slice(0, MAX_NEIGHBOR_PROBES)
    await mapPool(
      ips,
      SHARE_PROBE_CONCURRENCY,
      (ip) => probeNew(ip),
      () => isCancelled(generation) || overBudget()
    )
  })()

  const shellTask = (async () => {
    const names = await shellPromise
    if (isCancelled(generation) || overBudget()) return
    // Preserve Shell casing (NEWONYX); probe by that label.
    const candidates = [...new Map(names.map((n) => [n.toLowerCase(), n])).values()]
    await mapPool(
      candidates,
      SHARE_PROBE_CONCURRENCY,
      async (name) => {
        // Prefer shell casing even if ARP already added lowercase/IP.
        await probeNew(name, name)
      },
      () => isCancelled(generation) || overBudget()
    )
  })()

  await Promise.all([arpTask, shellTask])
  return collapsedHosts(byKey)
}

parentPort?.on('message', (msg: unknown) => {
  if (!msg || typeof msg !== 'object') return
  const m = msg as {
    type?: string
    generation?: number
    remembered?: NetworkHost[]
  }
  if (m.type === 'cancel' && typeof m.generation === 'number') {
    cancelledGeneration = Math.max(cancelledGeneration, m.generation)
    return
  }
  if (m.type !== 'discover' || typeof m.generation !== 'number') return
  const generation = m.generation
  const remembered = Array.isArray(m.remembered) ? m.remembered : []
  void (async () => {
    try {
      // Empty progress: renderer keeps prior online hosts until the first verified list arrives.
      parentPort?.postMessage({ type: 'progress', generation, hosts: [] })
      const hosts = await discoverHosts(generation, remembered)
      if (isCancelled(generation)) return
      parentPort?.postMessage({ type: 'done', generation, hosts })
    } catch (e) {
      if (isCancelled(generation)) return
      parentPort?.postMessage({
        type: 'error',
        generation,
        hosts: [],
        message: e instanceof Error ? e.message : String(e)
      })
    }
  })()
})
