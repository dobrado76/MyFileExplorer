import { basename, isUnderPath, samePath } from './paths'

export type TabRootHint = {
  id: string
  rootPath: string | null
  title: string | null
}

/** Tabs whose scoped root is one of `deletedPaths` or lives inside one. */
export function tabsWhoseRootIsDeleted<T extends TabRootHint>(
  tabs: readonly T[],
  deletedPaths: readonly string[]
): T[] {
  if (deletedPaths.length === 0) return []
  return tabs.filter((t) => {
    const root = t.rootPath
    if (!root) return false
    return deletedPaths.some((p) => samePath(root, p) || isUnderPath(root, p))
  })
}

export function tabRootDeletePrompt(
  hit: readonly TabRootHint[],
  permanent: boolean
): { title: string; message: string } {
  const roots = [...new Set(hit.map((t) => t.rootPath).filter((p): p is string => !!p))]
  const names = roots.map((p) => `“${basename(p)}”`)
  const folder =
    names.length === 1
      ? names[0]!
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.length} folders`
  const tabCount = hit.length
  const tabPhrase =
    tabCount === 1
      ? 'a tab. That tab will be closed.'
      : `${tabCount} tabs. Those tabs will be closed.`
  const dest = permanent ? ' The folder will be permanently deleted.' : ''
  return {
    title:
      roots.length <= 1
        ? 'Delete folder used as a tab root?'
        : 'Delete folders used as tab roots?',
    message: `${folder} ${roots.length === 1 ? 'is the root' : 'are roots'} of ${tabPhrase}${dest}`
  }
}
