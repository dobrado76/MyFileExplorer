import { useEffect, useRef, useState } from 'react'
import type { ItemAdsRecord } from '@shared/schemas/itemAds'
import { samePath } from './paths'
import { api } from './ipc'
import { useAppStore } from '../store/appStore'

const BATCH = 200

export function useItemAdsOverlays(
  paths: string[],
  enabled: boolean,
  resetKey?: string
): Record<string, ItemAdsRecord> {
  const bump = useAppStore((s) => s.columnMetaBump)
  const [byPath, setByPath] = useState<Record<string, ItemAdsRecord>>({})
  const requested = useRef(new Set<string>())
  const resetRef = useRef(resetKey)

  useEffect(() => {
    if (resetRef.current === resetKey) return
    resetRef.current = resetKey
    requested.current.clear()
    setByPath({})
  }, [resetKey])

  useEffect(() => {
    if (!bump.path) return
    if (resetKey && samePath(bump.path, resetKey)) {
      requested.current.clear()
      setByPath({})
      return
    }
    const target = bump.path
    requested.current.delete(target.toLowerCase())
    setByPath((prev) => {
      if (!(target in prev) && !Object.keys(prev).some((k) => samePath(k, target))) return prev
      const next = { ...prev }
      for (const k of Object.keys(next)) {
        if (samePath(k, target)) delete next[k]
      }
      return next
    })
  }, [bump.rev, bump.path, resetKey])

  const pathsKey = paths.join('\n')
  useEffect(() => {
    if (!enabled) return
    const list = pathsKey ? pathsKey.split('\n') : []
    const needed = list.filter((p) => p && !requested.current.has(p.toLowerCase()))
    if (needed.length === 0) return
    for (const p of needed) requested.current.add(p.toLowerCase())
    let cancelled = false
    void (async () => {
      for (let i = 0; i < needed.length; i += BATCH) {
        const slice = needed.slice(i, i + BATCH)
        const res = await api.itemAds.getMany({ paths: slice })
        if (cancelled) return
        if (!res.ok) {
          for (const p of slice) requested.current.delete(p.toLowerCase())
          continue
        }
        setByPath((prev) => ({ ...prev, ...res.value }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pathsKey, enabled, bump.rev])

  return byPath
}
