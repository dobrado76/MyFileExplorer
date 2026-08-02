import { useRef, type JSX } from 'react'
import { resolveFolderView } from '@shared/folderViews'
import { useAppStore } from '../store/appStore'
import { Breadcrumb } from './Breadcrumb'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RefreshIcon,
  SearchIcon,
  CloseIcon,
  PanelIcon,
  SettingsIcon,
  EyeIcon,
  EyeOffIcon
} from '../lib/icons'
import { parentOf } from '../lib/paths'
import type { ViewMode } from '@shared/schemas/session'

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: 'extraLargeIcons', label: 'Extra large icons' },
  { mode: 'largeIcons', label: 'Large icons' },
  { mode: 'mediumIcons', label: 'Medium icons' },
  { mode: 'smallIcons', label: 'Small icons' },
  { mode: 'list', label: 'List' },
  { mode: 'details', label: 'Details' }
]

export function Toolbar(): JSX.Element {
  const tab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const goBack = useAppStore((s) => s.goBack)
  const goForward = useAppStore((s) => s.goForward)
  const goUp = useAppStore((s) => s.goUp)
  const refresh = useAppStore((s) => s.refresh)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const search = useAppStore((s) => s.search)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const setSearchIndexedOnly = useAppStore((s) => s.setSearchIndexedOnly)
  const runSearch = useAppStore((s) => s.runSearch)
  const clearSearch = useAppStore((s) => s.clearSearch)
  const splitters = useAppStore((s) => s.splitters)
  const setSplitters = useAppStore((s) => s.setSplitters)
  const openDialog = useAppStore((s) => s.openDialog)
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const folderViews = useAppStore((s) => s.settings.folderViews)

  const searchInputRef = useRef<HTMLInputElement>(null)

  if (!tab) return <div className="toolbar" />

  const owning = resolveFolderView(tab.path, folderViews)
  const viewMode = owning?.viewMode ?? tab.viewMode

  return (
    <div className="toolbar">
      <button
        className="icon-btn"
        aria-label="Back"
        title="Back (Alt+Left)"
        disabled={tab.back.length === 0}
        onClick={() => void goBack()}
      >
        <ArrowLeft />
      </button>
      <button
        className="icon-btn"
        aria-label="Forward"
        title="Forward (Alt+Right)"
        disabled={tab.forward.length === 0}
        onClick={() => void goForward()}
      >
        <ArrowRight />
      </button>
      <button
        className="icon-btn"
        aria-label="Up"
        title="Up (Backspace)"
        disabled={parentOf(tab.path) === null}
        onClick={() => void goUp()}
      >
        <ArrowUp />
      </button>
      <button
        className="icon-btn"
        aria-label="Refresh"
        title="Refresh (F5)"
        onClick={() => void refresh()}
      >
        <RefreshIcon />
      </button>

      <Breadcrumb />

      <select
        aria-label="View mode"
        value={viewMode}
        onChange={(e) => setViewMode(e.target.value as ViewMode)}
        title={owning ? 'View mode (folder customization)' : 'View mode'}
      >
        {VIEW_MODES.map((v) => (
          <option key={v.mode} value={v.mode}>
            {v.label}
          </option>
        ))}
      </select>

      <div className="searchbox">
        <SearchIcon size={14} />
        <input
          ref={searchInputRef}
          data-search-input
          placeholder="Search"
          value={search.query}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
            if (e.key === 'Escape') {
              if (search.active) clearSearch()
              searchInputRef.current?.blur()
            }
            e.stopPropagation()
          }}
          aria-label="Search"
        />
        <label title="Search all indexed roots instead of the current folder">
          <input
            type="checkbox"
            checked={search.indexedOnly}
            onChange={(e) => setSearchIndexedOnly(e.target.checked)}
          />
          indexed
        </label>
        {search.active && (
          <button className="icon-btn" aria-label="Clear search" onClick={clearSearch}>
            <CloseIcon size={12} />
          </button>
        )}
      </div>

      <button
        className={`icon-btn${settings.viewFilterEnabled ? ' active' : ''}`}
        aria-label="Toggle view filter"
        title={
          settings.viewFilterEnabled
            ? 'View filter on — hides Windows Hidden items and your filter patterns (click to show all)'
            : 'View filter off — showing Hidden items and filter matches (click to hide)'
        }
        onClick={() => void applySettingsPatch({ viewFilterEnabled: !settings.viewFilterEnabled })}
      >
        {settings.viewFilterEnabled ? <EyeOffIcon /> : <EyeIcon />}
      </button>
      <button
        className={`icon-btn${splitters.previewCollapsed ? '' : ' active'}`}
        aria-label="Toggle preview pane"
        title="Toggle preview (Ctrl+Shift+P)"
        onClick={() => setSplitters({ previewCollapsed: !splitters.previewCollapsed })}
      >
        <PanelIcon />
      </button>
      <button
        className="icon-btn"
        aria-label="Settings"
        title="Settings"
        onClick={() => openDialog({ kind: 'settings' })}
      >
        <SettingsIcon />
      </button>
    </div>
  )
}
