import { useRef, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import {
  SearchIcon,
  SlidersIcon,
  CloseIcon,
  PanelIcon,
  TreePanelIcon,
  SettingsIcon,
  ScriptIcon,
  EyeIcon,
  EyeOffIcon,
  UndoIcon,
  RedoIcon,
  CutIcon,
  CopyIcon,
  PasteIcon,
  TrashIcon,
  SelectAllIcon,
  CollapseAllIcon,
  PlayIcon,
  CompiledListsPlayIcon,
  ListPlusIcon,
  SaveIcon,
  FolderOpenIcon,
  EraserIcon
} from '../lib/icons'
import { LayoutsMenu } from './LayoutsMenu'
import { NewItemMenu } from './NewItemMenu'
import { SearchOptionsMenu } from './SearchOptionsMenu'
import { ViewLayoutSelector } from './ViewLayoutSelector'
import { RemoteReposToolbar } from './RemoteReposToolbar'
import { MediaLibraryToolbar } from './MediaLibraryToolbar'
import { isVolumeRootPath } from '../lib/rightDrag'

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
  const toggleSelectAll = useAppStore((s) => s.toggleSelectAll)
  const allSelected = useAppStore((s) => s.isAllSelected())
  const collapseAllTree = useAppStore((s) => s.collapseAllTree)
  const treeHasExpanded = useAppStore((s) => s.activeTab().treeExpanded.length > 0)
  const deleteFromRecycleBinView = useAppStore((s) => s.deleteFromRecycleBinView)
  const devGateActive = useAppStore((s) => s.devGateActive)
  const startSlideshow = useAppStore((s) => s.startSlideshow)
  const compiledSlideshowToolbarClick = useAppStore((s) => s.compiledSlideshowToolbarClick)
  const slideshowCacheActive = useAppStore((s) => s.slideshow.cacheActive)
  const setSlideshowCacheActive = useAppStore((s) => s.setSlideshowCacheActive)
  const loadSlideshowImageListDialog = useAppStore((s) => s.loadSlideshowImageListDialog)
  const saveSlideshowImageListDialog = useAppStore((s) => s.saveSlideshowImageListDialog)
  const clearSlideshowImageCache = useAppStore((s) => s.clearSlideshowImageCache)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const hasSelection = selected.length > 0
  const canDelete =
    recycleBinActive
      ? hasSelection
      : hasSelection && selected.some((p) => !isVolumeRootPath(p))
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
          disabled={!canDelete}
          onClick={() => {
            if (recycleBinActive) deleteFromRecycleBinView()
            else void deleteSelection(false)
          }}
        >
          <TrashIcon />
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button
          className={`icon-btn${allSelected ? ' active' : ''}`}
          aria-label={allSelected ? 'Deselect all' : 'Select all'}
          aria-pressed={allSelected}
          title={allSelected ? 'Deselect all' : 'Select all (Ctrl+A)'}
          onClick={() => toggleSelectAll()}
        >
          <SelectAllIcon />
        </button>
        <button
          className="icon-btn"
          aria-label="Collapse all"
          title="Collapse all folders in this tab's tree"
          disabled={!treeHasExpanded}
          onClick={() => collapseAllTree()}
        >
          <CollapseAllIcon />
        </button>
      </div>

      {settings.slideshowFeaturesEnabled && (
        <div className="toolbar-edit" role="group" aria-label="Slideshow">
          <span className="toolbar-sep" aria-hidden />
          <button
            className="icon-btn"
            aria-label="Start slideshow"
            title="Start slideshow"
            onClick={() => void startSlideshow()}
          >
            <PlayIcon />
          </button>
          {devGateActive && settings.slideshow.compiledFileListsFolder.trim() !== '' && (
            <button
              className="icon-btn"
              aria-label="Compiled lists slideshow"
              title="Compiled lists — resume last.txt or open list manager"
              onClick={() => void compiledSlideshowToolbarClick()}
            >
              <CompiledListsPlayIcon />
            </button>
          )}
          <button
            className={`icon-btn${slideshowCacheActive ? ' active' : ''}`}
            aria-label="Cache image list"
            title={
              slideshowCacheActive
                ? 'Image list cache on — Start uses memory list'
                : 'Image list cache off — Start always walks disk'
            }
            onClick={() => setSlideshowCacheActive(!slideshowCacheActive)}
          >
            <ListPlusIcon />
          </button>
          {slideshowCacheActive && (
            <>
              <button
                className="icon-btn"
                aria-label="Add to image list"
                title="Add to image list (.dat)"
                onClick={() => void loadSlideshowImageListDialog('add')}
              >
                <FolderOpenIcon />
              </button>
              <button
                className="icon-btn"
                aria-label="Save image list"
                title="Save image list (.dat)"
                onClick={() => void saveSlideshowImageListDialog()}
              >
                <SaveIcon />
              </button>
              <button
                className="icon-btn"
                aria-label="Load image list"
                title="Load image list (.dat)"
                onClick={() => void loadSlideshowImageListDialog('replace')}
              >
                <FolderOpenIcon />
              </button>
              <button
                className="icon-btn"
                aria-label="Clear image list"
                title="Clear image list cache"
                onClick={() => clearSlideshowImageCache()}
              >
                <EraserIcon />
              </button>
            </>
          )}
        </div>
      )}

      <RemoteReposToolbar />
      <MediaLibraryToolbar />

      <div className="toolbar-trailing">
        <ViewLayoutSelector />
        <div className="search-cluster">
          <div className="searchbox">
            <SearchIcon />
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
                onClick={() => clearSearch()}
              >
                <CloseIcon size={12} />
              </button>
            )}
          </div>
          <SearchOptionsMenu />
          <button
            type="button"
            className="icon-btn"
            aria-label="Power search"
            title="Power search (Ctrl+Shift+F)"
            onClick={() => openDialog({ kind: 'power-search' })}
          >
            <SlidersIcon />
          </button>
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
          className={`icon-btn${splitters.treeCollapsed ? '' : ' active'}`}
          aria-label="Toggle folder tree"
          title="Toggle folder tree"
          onClick={() => setSplitters({ treeCollapsed: !splitters.treeCollapsed })}
        >
          <TreePanelIcon />
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
        {settings.scripts.enabled && (
          <button
            className="icon-btn"
            aria-label="Scripts"
            title="Script Manager"
            onClick={() => openDialog({ kind: 'script-manager' })}
          >
            <ScriptIcon />
          </button>
        )}
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
