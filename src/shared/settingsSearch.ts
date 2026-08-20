export type SettingsSection =
  | 'appearance'
  | 'behavior'
  | 'contextmenu'
  | 'quickaccess'
  | 'layouts'
  | 'folderviews'
  | 'filter'
  | 'preview'
  | 'search'
  | 'network'
  | 'remoterepos'
  | 'slideshow'
  | 'mediametadata'
  | 'ai'
  | 'advanced'
  | 'about'

export type SettingsNavItem = {
  id: SettingsSection
  label: string
  /** Aliases and field names so the nav matches before that pane is mounted. */
  keywords: string
}

export const SETTINGS_SEARCH_DEBOUNCE_MS = 180

export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    keywords:
      'theme dark light custom font family size icon px tab equal width icons color colour colors chrome look'
  },
  {
    id: 'behavior',
    label: 'Behavior',
    keywords:
      'folders first checkbox checkboxes explorer default new tab path home video thumbnail thumb frame delay vidthumb autoplay preview confirm delete recycle bin trash permanent shift+del hide extension lnk url shortcut folder statistics size files columns calculate skip'
  },
  {
    id: 'contextmenu',
    label: 'Context menu',
    keywords:
      'context menu right-click builtin built-in discover shell verb custom photoshop vlc vscode notepad++ command exe files folders submenu separator order hide'
  },
  {
    id: 'quickaccess',
    label: 'Quick access',
    keywords: 'quick access pin unpin desktop downloads documents pictures shortcuts tree favorites'
  },
  {
    id: 'layouts',
    label: 'Layouts',
    keywords: 'layout workspace named tabs panes splitters save apply rename workspace'
  },
  {
    id: 'folderviews',
    label: 'Folder views',
    keywords: 'folder views customize columns sort details recursive tree per-folder'
  },
  {
    id: 'filter',
    label: 'View filter',
    keywords: 'view filter hidden hide pattern wildcard node_modules tmp eye toolbar glob'
  },
  {
    id: 'preview',
    label: 'Preview',
    keywords: 'preview pane text markdown html max bytes truncate code wrap word wrap'
  },
  {
    id: 'search',
    label: 'Search index',
    keywords:
      'search index everything roots drive volume reindex exclude node_modules bookmarks filters macro indexed'
  },
  {
    id: 'network',
    label: 'Network',
    keywords: 'network lan smb unc discovery map drive disconnect refresh neighborhood local computer'
  },
  {
    id: 'remoterepos',
    label: 'Remote repositories',
    keywords: 'remote ftp ftps sftp ssh repository bookmark deploy'
  },
  {
    id: 'slideshow',
    label: 'Slideshow',
    keywords: 'slideshow categorizer caption compiled lists delay order random loop images photos'
  },
  {
    id: 'mediametadata',
    label: 'Media Metadata',
    keywords:
      'media metadata plex tmdb omdb imdb cover poster season episode watched genre movie tv show'
  },
  {
    id: 'ai',
    label: 'Scripting and AI',
    keywords:
      'scripting scripts ai python powershell pwsh cmd bash interpreter openai openrouter lmstudio provider api key model temperature tokens generate runner'
  },
  {
    id: 'advanced',
    label: 'Advanced',
    keywords:
      'hardware acceleration gpu vram cache thumbnail icon userdata search http api localhost port token'
  },
  {
    id: 'about',
    label: 'About',
    keywords: 'about version github update export import settings backup portable'
  }
]

export function settingsSearchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

export function textMatchesSettingsSearch(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const hay = haystack.toLowerCase()
  return tokens.every((t) => hay.includes(t))
}

export function sectionMatchesSettingsSearch(item: SettingsNavItem, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  return textMatchesSettingsSearch(`${item.label} ${item.keywords}`, tokens)
}

export function filterSettingsNav(
  items: readonly SettingsNavItem[],
  tokens: string[]
): SettingsNavItem[] {
  if (tokens.length === 0) return [...items]
  return items.filter((item) => sectionMatchesSettingsSearch(item, tokens))
}

export function pickSettingsSectionForSearch(
  current: SettingsSection,
  visible: readonly SettingsNavItem[]
): SettingsSection | null {
  const first = visible[0]
  if (!first) return null
  if (visible.some((item) => item.id === current)) return current
  return first.id
}
