import { useEffect, useMemo, useState } from 'react'
import type { ItemAdsRecord } from '@shared/schemas/itemAds'
import { samePath } from './paths'
import { api } from './ipc'
import { useAppStore } from '../store/appStore'

const BATCH = 200
/** Cap session ADS overlays (notes + icon + optional PNG). App reload clears. */
const SESSION_MAX = 6000

/**
 * Process-lifetime cache so tab / folder switches do not flash shell glyphs
 * while custom / Lucide icons re-fetch from ADS.
 */
const sessionByPath = new Map<string, ItemAdsRecord>()
/** Paths with an in-flight getMany (shared across FileView + tree hooks). */
const sessionInFlight = new Set<string>()

function sessionKey(p: string): string {
  return p.toLowerCase()
}

function sessionGet(p: string): ItemAdsRecord | undefined {
  const k = sessionKey(p)
  const hit = sessionByPath.get(k)
  if (!hit) return undefined
  // LRU touch
  sessionByPath.delete(k)
  sessionByPath.set(k, hit)
  return hit
}

function sessionHas(p: string): boolean {
  return sessionByPath.has(sessionKey(p))
}

function sessionSet(p: string, rec: ItemAdsRecord): void {
  const k = sessionKey(p)
  if (sessionByPath.has(k)) sessionByPath.delete(k)
  sessionByPath.set(k, rec)
  while (sessionByPath.size > SESSION_MAX) {
    const oldest = sessionByPath.keys().next().value
    if (oldest === undefined) break
    sessionByPath.delete(oldest)
  }
}

function sessionDeleteMatching(target: string): void {
  for (const k of [...sessionByPath.keys()]) {
    if (samePath(k, target)) sessionByPath.delete(k)
  }
  sessionInFlight.delete(sessionKey(target))
}

/**
 * NTFS note / icon overlays for visible rows.
 * `resetKey` is retained for call-site compatibility but no longer wipes the
 * session cache (that caused shell→custom flashes on every tab switch).
 */
export function useItemAdsOverlays(
  paths: string[],
  enabled: boolean,
  _resetKey?: string
): Record<string, ItemAdsRecord> {
  const bump = useAppStore((s) => s.columnMetaBump)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    if (!bump.path) return
    sessionDeleteMatching(bump.path)
    setEpoch((n) => n + 1)
  }, [bump.rev, bump.path])

  const pathsKey = paths.join('\n')
  useEffect(() => {
    if (!enabled) return
    const list = pathsKey ? pathsKey.split('\n').filter(Boolean) : []
    const needed = list.filter((p) => !sessionHas(p) && !sessionInFlight.has(sessionKey(p)))
    if (needed.length === 0) return

    for (const p of needed) sessionInFlight.add(sessionKey(p))
    let cancelled = false
    const released = new Set<string>()
    const release = (p: string): void => {
      const k = sessionKey(p)
      if (released.has(k)) return
      released.add(k)
      sessionInFlight.delete(k)
    }

    void (async () => {
      for (let i = 0; i < needed.length; i += BATCH) {
        const slice = needed.slice(i, i + BATCH)
        const res = await api.itemAds.getMany({ paths: slice })
        if (cancelled) {
          for (const p of slice) release(p)
          continue
        }
        if (!res.ok) {
          for (const p of slice) release(p)
          continue
        }
        for (const p of slice) {
          const rec = res.value[p] ?? { note: null, icon: null, iconPngBase64: null }
          sessionSet(p, rec)
          release(p)
        }
        // Paths the main omitted (soft-fail) — still mark empty so we do not refetch forever.
        for (const p of slice) {
          if (!sessionHas(p)) {
            sessionSet(p, { note: null, icon: null, iconPngBase64: null })
            release(p)
          }
        }
        setEpoch((n) => n + 1)
      }
    })()

    return () => {
      cancelled = true
      // Unlock incomplete paths so a later effect can retry (tree expand churn).
      for (const p of needed) {
        if (!sessionHas(p)) release(p)
      }
    }
  }, [pathsKey, enabled, bump.rev])

  return useMemo(() => {
    if (!enabled) return {}
    const list = pathsKey ? pathsKey.split('\n').filter(Boolean) : []
    const out: Record<string, ItemAdsRecord> = {}
    for (const p of list) {
      const hit = sessionGet(p)
      if (hit) out[p] = hit
    }
    return out
    // epoch: re-read session after fetches / invalidation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey, enabled, epoch])
}
