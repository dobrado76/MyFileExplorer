import { groupScriptsByCategory, scriptMatchesMenu, type ScriptMenuContext } from '@shared/scriptMatch'
import type { ScriptDefinition } from '@shared/schemas/scripts'

export type ScriptMenuRow = {
  label: string
  action?: () => void
  items?: ScriptMenuRow[]
}

export function buildScriptsMenuItems(input: {
  scripts: ScriptDefinition[]
  ctx: ScriptMenuContext
  aiEnabled: boolean
  onRun(script: ScriptDefinition): void
  onManage(): void
  onGenerate(): void
}): ScriptMenuRow[] {
  const eligible = input.scripts.filter((s) => scriptMatchesMenu(s, input.ctx))
  const groups = groupScriptsByCategory(eligible)
  const items: ScriptMenuRow[] = []
  for (const g of groups) {
    const rows = g.items.map((s) => ({
      label: s.name,
      action: () => input.onRun(s)
    }))
    if (g.category) items.push({ label: g.category, items: rows })
    else items.push(...rows)
  }
  if (items.length > 0) items.push({ label: '—', action: undefined })
  items.push({
    label: input.aiEnabled ? 'Generate script with AI…' : 'Generate script with AI…',
    action: input.onGenerate
  })
  items.push({ label: 'Manage Scripts…', action: input.onManage })
  return items
}

export function isRemoteLocation(path: string | null | undefined): boolean {
  return !!path && path.toLowerCase().startsWith('mfe-remote://')
}
