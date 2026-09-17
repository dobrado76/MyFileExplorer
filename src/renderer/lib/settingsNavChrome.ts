import type { LucideIcon } from 'lucide-react'
import {
  AppWindow,
  Clapperboard,
  Cloud,
  Filter,
  FolderTree,
  GitBranch,
  Images,
  Info,
  LayoutGrid,
  Menu,
  MousePointerClick,
  Network,
  Palette,
  PanelRight,
  Rocket,
  Search,
  Settings2,
  Sparkles,
  Star,
  Tags
} from 'lucide-react'
import type { SettingsSection } from '@shared/settingsSearch'

/** Per-section glyph + accent for the Settings side nav (renderer-only). */
export const SETTINGS_NAV_CHROME: Record<
  SettingsSection,
  { Icon: LucideIcon; color: string }
> = {
  appearance: { Icon: Palette, color: '#c084fc' },
  behavior: { Icon: MousePointerClick, color: '#60a5fa' },
  contextmenu: { Icon: Menu, color: '#94a3b8' },
  quickaccess: { Icon: Star, color: '#fbbf24' },
  quicklaunch: { Icon: Rocket, color: '#fb923c' },
  layouts: { Icon: LayoutGrid, color: '#2dd4bf' },
  folderviews: { Icon: FolderTree, color: '#e8b64c' },
  filter: { Icon: Filter, color: '#22d3ee' },
  preview: { Icon: PanelRight, color: '#818cf8' },
  search: { Icon: Search, color: '#4ade80' },
  network: { Icon: Network, color: '#38bdf8' },
  windowsintegration: { Icon: AppWindow, color: '#3b82f6' },
  remoterepos: { Icon: Cloud, color: '#a78bfa' },
  slideshow: { Icon: Images, color: '#f472b6' },
  mediametadata: { Icon: Clapperboard, color: '#f87171' },
  metadata: { Icon: Tags, color: '#a3e635' },
  git: { Icon: GitBranch, color: '#f97316' },
  ai: { Icon: Sparkles, color: '#e879f9' },
  advanced: { Icon: Settings2, color: '#9ca3af' },
  about: { Icon: Info, color: '#67e8f9' }
}
