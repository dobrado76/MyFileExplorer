import { samePath } from './paths'
import {
  flattenQuickAccessTokens,
  type QuickAccessItem
} from '@shared/schemas/quickAccess'

export type KnownFolderId =
  | 'desktop'
  | 'downloads'
  | 'documents'
  | 'pictures'
  | 'music'
  | 'videos'
  | 'home'

export type KnownFolder = { id: KnownFolderId; label: string; path: string }

export type QuickAccessEntry = {
  /** Builtin id or absolute path — the persisted token. */
  token: string
  path: string
  label: string
  builtinId: KnownFolderId | null
}

/** Default Quick access builtins — Home intentionally omitted. */
export const DEFAULT_QUICK_ACCESS_IDS: KnownFolderId[] = [
  'desktop',
  'downloads',
  'documents',
  'pictures'
]

const BUILTIN_ID_SET = new Set<string>([
  'desktop',
  'downloads',
  'documents',
  'pictures',
  'music',
  'videos',
  'home'
])

export function isQuickAccessBuiltinId(token: string): token is KnownFolderId {
  return BUILTIN_ID_SET.has(token.toLowerCase())
}

function folderLabel(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

/**
 * Resolve the ordered token list from settings.
 * Empty `quickAccess` → factory defaults (or migrate legacy pin/hidden fields).
 */
export function materializeQuickAccessList(
  quickAccess: QuickAccessItem[],
  legacyPins: string[],
  legacyHidden: string[]
): QuickAccessItem[] {
  if (quickAccess.length > 0) return [...quickAccess]
  if (legacyPins.length > 0 || legacyHidden.length > 0) {
    const hidden = new Set(legacyHidden.map((x) => x.toLowerCase()))
    return [
      ...DEFAULT_QUICK_ACCESS_IDS.filter((id) => !hidden.has(id)),
      ...legacyPins
    ]
  }
  return [...DEFAULT_QUICK_ACCESS_IDS]
}

export function materializeQuickAccessTokens(
  quickAccess: QuickAccessItem[],
  legacyPins: string[],
  legacyHidden: string[]
): string[] {
  return flattenQuickAccessTokens(materializeQuickAccessList(quickAccess, legacyPins, legacyHidden))
}

export function buildQuickAccess(
  known: KnownFolder[],
  tokens: string[]
): QuickAccessEntry[] {
  const out: QuickAccessEntry[] = []
  const seen = new Set<string>()

  for (const raw of tokens) {
    if (!raw) continue
    if (isQuickAccessBuiltinId(raw)) {
      const id = raw.toLowerCase() as KnownFolderId
      const kf = known.find((k) => k.id === id)
      if (!kf?.path) continue
      const key = kf.path.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ token: id, path: kf.path, label: kf.label, builtinId: id })
      continue
    }
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const kf = known.find((k) => samePath(k.path, raw))
    out.push({
      token: raw,
      path: raw,
      label: kf?.label ?? folderLabel(raw),
      builtinId: kf?.id ?? null
    })
  }

  return out
}

export function tokenForPath(path: string, known: KnownFolder[]): string {
  const builtin = known.find((k) => samePath(k.path, path))
  return builtin ? builtin.id : path
}

export function isInQuickAccess(path: string, entries: QuickAccessEntry[]): boolean {
  return entries.some((e) => samePath(e.path, path))
}
