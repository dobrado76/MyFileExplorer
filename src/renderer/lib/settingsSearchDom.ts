import { textMatchesSettingsSearch } from '@shared/settingsSearch'

const BLOCK_ROOT_SELECTOR = '.settings-grid, .settings-stack'

function collectSettingsSearchBlocks(pane: HTMLElement): HTMLElement[] {
  const roots = pane.querySelectorAll(BLOCK_ROOT_SELECTOR)
  const out: HTMLElement[] = []
  for (const root of roots) {
    for (const child of root.children) {
      if (child instanceof HTMLElement) out.push(child)
    }
  }
  return out
}

function isSettingsHeading(el: HTMLElement): boolean {
  return el.tagName === 'H3' || el.classList.contains('form-section')
}

function hideOrphanedSettingsHeadings(blocks: HTMLElement[]): void {
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i]
    if (!el || !isSettingsHeading(el)) continue
    let visibleChild = false
    for (let j = i + 1; j < blocks.length; j++) {
      const next = blocks[j]
      if (!next) break
      if (isSettingsHeading(next)) break
      if (!next.classList.contains('settings-search-hidden')) {
        visibleChild = true
        break
      }
    }
    el.classList.toggle('settings-search-hidden', !visibleChild)
  }
}

function blockMatches(el: HTMLElement, tokens: string[]): boolean {
  if (el.classList.contains('settings-search-keep')) return true
  const extra = el.getAttribute('data-settings-search') ?? ''
  return textMatchesSettingsSearch(`${el.textContent ?? ''} ${extra}`, tokens)
}

/** Hide pane blocks that do not match. If nothing matches, leave the section visible. */
export function applySettingsPaneFilter(pane: HTMLElement, tokens: string[]): void {
  const blocks = collectSettingsSearchBlocks(pane)
  if (tokens.length === 0) {
    for (const el of blocks) el.classList.remove('settings-search-hidden')
    return
  }

  const matched = blocks.filter((el) => blockMatches(el, tokens))
  const anyContentMatch = matched.some((el) => !el.classList.contains('settings-search-keep'))
  if (!anyContentMatch) {
    for (const el of blocks) el.classList.remove('settings-search-hidden')
    return
  }

  for (const el of blocks) {
    const keep = el.classList.contains('settings-search-keep')
    el.classList.toggle('settings-search-hidden', !keep && !matched.includes(el))
  }
  hideOrphanedSettingsHeadings(blocks)
}
