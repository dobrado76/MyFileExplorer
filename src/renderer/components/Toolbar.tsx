import { useRef, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import {
  SearchIcon,
  CloseIcon,
  PanelIcon,
  SettingsIcon,
  EyeIcon,
  EyeOffIcon,
  UndoIcon,
  RedoIcon,
  CutIcon,
  CopyIcon,
  PasteIcon,
  TrashIcon,
  SelectAllIcon
} from '../lib/icons'
import { LayoutsMenu } from './LayoutsMenu'
import { NewItemMenu } from './NewItemMenu'
import { SearchOptionsMenu } from './SearchOptionsMenu'
import { ViewLayoutSelector } from './ViewLayoutSelector'

export function Toolbar(): JSX.Element {
  const search = useAppStore((s) => s.search)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const runSearch = useAppStore((s) => s.runSearch)
  const clearSearch = useAppStore((s) => s.clearSearch)
  const splitters = useAppStore((s) => s.splitters)
  const setSplitters = useAppStore((s) => s.setSplitters)
  const openDialog = useAppStore((s) => s.openDialog)
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)

  const selected = useAppStore((s) => s.activeTab().selected)
  const recycleBinActive = useAppStore((s) => s.recycleBin.active)
  const canUndo = useAppStore((s) => s.canUndo())
  const canRedo = useAppStore((s) => s.canRedo())
  const undoLabel = useAppStore((s) => s.undoLabel())
  const redoLabel = useAppStore((s) => s.redoLabel())
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  const copySelection = useAppStore((s) => s.copySelection)
  const cutSelection = useAppStore((s) => s.cutSelection)
  const paste = useAppStore((s) => s.paste)
  const deleteSelection = useAppStore((s) => s.deleteSelection)
  const selectAll = useAppStore((s) => s.selectAll)
  const deleteFromRecycleBinView = useAppStore((s) => s.deleteFromRecycleBinView)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const hasSelection = selected.length > 0
  const canEditFs = !recycleBinActive

  return (
    <div className="toolbar toolbar-global">
      <div className="toolbar-edit" role="group" aria-label="Edit">
        <NewItemMenu />
        <span className="toolbar-sep" aria-hidden />
        <button
          className="icon-btn"
          aria-label="Undo"
          title={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
          disabled={!canUndo}
          onClick={() => void undo()}
        >
          <UndoIcon />
        </button>
        <button
          className="icon-btn"
          aria-label="Redo"
          title={redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : 'Redo (Ctrl+Y)'}
          disabled={!canRedo}
          onClick={() => void redo()}
        >
          <RedoIcon />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          className="icon-btn"
          aria-label="Cut"
          title="Cut (Ctrl+X)"
          disabled={!hasSelection || !canEditFs}
          onClick={() => cutSelection()}
        >
          <CutIcon />
        </button>
        <button
          className="icon-btn"
          aria-label="Copy"
          title="Copy (Ctrl+C)"
          disabled={!hasSelection}
          onClick={() => copySelection()}
        >
          <CopyIcon />
        </button>
        <button
          className="icon-btn"
          aria-label="Paste"
          title="Paste (Ctrl+V)"
          disabled={!canEditFs}
          onClick={() => void paste()}
        >
          <PasteIcon />
        </button>
        <button
          className="icon-btn"
          aria-label="Delete"
          title={
            recycleBinActive
              ? 'Delete permanently from Recycle Bin'
              : 'Delete (Del → Recycle Bin; Shift+Del permanent)'
          }
          disabled={!hasSelection}
          onClick={() => {
            if (recycleBinActive) deleteFromRecycleBinView()
            else void deleteSelection(false)
          }}
        >
          <TrashIcon />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          className="icon-btn"
          aria-label="Select all"
          title="Select all (Ctrl+A)"
          onClick={() => selectAll()}
        >
          <SelectAllIcon />
        </button>
      </div>

      <div className="toolbar-trailing">
        <ViewLayoutSelector />
        <div className="search-cluster">
          <div className="searchbox">
            <SearchIcon size={14} />
            <input
              ref={searchInputRef}
              data-search-input
              placeholder="Search…"
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
            {search.active && (
              <button
                type="button"
                className="icon-btn searchbox-clear"
                aria-label="Clear search"
                onClick={clearSearch}
              >
                <CloseIcon size={12} />
              </button>
            )}
          </div>
          <SearchOptionsMenu />
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
        <LayoutsMenu />
        <button
          className="icon-btn"
          aria-label="Settings"
          title="Settings"
          onClick={() => openDialog({ kind: 'settings' })}
        >
          <SettingsIcon />
        </button>
      </div>
    </div>
  )
}
