import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import type {
  ConflictDecision,
  ConflictItem,
  ConflictSide,
  IssueDecision,
  OpIssue
} from '@shared/schemas/fs'
import {
  actionsForKind,
  groupOpIssues,
  issueKey,
  type OpIssueKind
} from '@shared/opIssues'
import type { CustomTheme } from '@shared/schemas/settings'
import {
  FONT_SIZE_PX_MAX,
  FONT_SIZE_PX_MIN,
  ICON_SIZE_PX_MAX,
  ICON_SIZE_PX_MIN,
  NETWORK_DISCOVERY_INTERVAL_MAX_MINUTES,
  NETWORK_DISCOVERY_INTERVAL_MIN_MINUTES
} from '@shared/schemas/settings'
import type { FolderMeasureResult, PropertiesModel } from '@shared/schemas/properties'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { FileOpPlanDialog } from './FileOpPlanDialog'
import { FileLockersPanel } from './FileLockersPanel'
import { formatBytes, formatDate } from '../lib/format'
import { folderViewSummary } from '@shared/folderViews'
import { addFolderStatsSkipPath, removeFolderStatsSkipPath } from '@shared/folderStatsSkip'
import { samePath } from '@shared/paths'
import { formatLayoutUpdatedAt, layoutSummary } from '@shared/layouts'
import { VID_THUMB_FRAME_MS_MAX, VID_THUMB_FRAME_MS_MIN } from '@shared/vidThumbCache'
import {
  MEDIA_METADATA_COVER_HEIGHT_MAX,
  MEDIA_METADATA_COVER_HEIGHT_MIN
} from '@shared/schemas/mediaMetadata'
import { parseMediaSourceInput } from '@shared/mediaMetadata'
import { buildQuickAccess, materializeQuickAccessList } from '../lib/quickAccess'
import {
  flattenQuickAccessTokens,
  isQuickAccessGroup,
  nextQuickAccessGroupName
} from '@shared/schemas/quickAccess'
import {
  MAX_FILE_TEMPLATES,
  sanitizeTemplateStem,
  templateCreatedName,
  templateExt,
  templateInputLabel
} from '@shared/schemas/templates'
import { basename, parentOf } from '../lib/paths'
import { iconForEntry, isImageExt } from '../lib/icons'
import { DEFAULT_UPDATES_SOURCE, GITHUB_REPO_URL, resolveUpdatesSource } from '@shared/updatesSource'
import { ThumbImage } from './ThumbImage'
import { ShellIcon } from './ShellIcon'
import { TabIconPickerDialog } from './TabIconPickerDialog'
import { TabCustomIconDialog } from './TabCustomIconDialog'
import { ItemNoteDialog } from './ItemNoteDialog'
import { ItemIconPickerDialog } from './ItemIconPickerDialog'
import { CategorizerMapManager } from './CategorizerMapManager'
import { CompiledListsConfigDialog } from './CompiledListsConfigDialog'
import { AdsManager } from './AdsManager'
import { UsnManager } from './UsnManager'
import { PowerRenameDialog } from './PowerRenameDialog'
import { PowerSearchDialog } from './PowerSearchDialog'
import { CopyMoveToDialog } from './CopyMoveToDialog'
import { CreateLinkDialog } from './CreateLinkDialog'
import { CloneGitRepoDialog } from './git/CloneGitRepoDialog'
import { ContextMenuSettingsPanel } from './ContextMenuSettingsPanel'
import { QuickLaunchSettingsPanel } from './QuickLaunchSettingsPanel'
import { CloseIcon } from '../lib/icons'
import { CoverPickerDialog } from './CoverPickerDialog'
import { ScriptManagerDialog } from './ScriptManagerDialog'
import { ScriptRunnerDialog } from './ScriptRunnerDialog'
import { ScriptGenerateDialog } from './ScriptGenerateDialog'
import { AiSettingsPanel } from './AiSettingsPanel'
import { SettingsClampedNumber } from './SettingsClampedNumber'
import {
  SETTINGS_NAV,
  SETTINGS_SEARCH_DEBOUNCE_MS,
  filterSettingsNav,
  pickSettingsSectionForSearch,
  settingsSearchTokens,
  type SettingsSection
} from '@shared/settingsSearch'
import { applySettingsPaneFilter } from '../lib/settingsSearchDom'
import { isValidAdsStreamName } from '@shared/ads/paths'
import { resolveFolderView } from '@shared/folderViews'
import {
  ADS_FIELD_COLUMN_DEFAULT_WIDTH,
  adsFieldColumnId,
  mergeAdsFieldColumns
} from '@shared/schemas/columns'
import { ADS_LIST_NAMES_MANY_MAX_PATHS } from '@shared/schemas/ads'

type DialogBounds = { x: number; y: number; width: number; height: number }
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

function clampDialogBounds(b: DialogBounds, minW: number, minH: number): DialogBounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.max(minW, Math.floor(vw * 0.96))
  const maxH = Math.max(minH, Math.floor(vh * 0.92))
  const width = Math.min(Math.max(Math.round(b.width), minW), maxW)
  const height = Math.min(Math.max(Math.round(b.height), minH), maxH)
  const x = Math.min(Math.max(Math.round(b.x), 0), Math.max(0, vw - width))
  const y = Math.min(Math.max(Math.round(b.y), 0), Math.max(0, vh - height))
  return { x, y, width, height }
}

function centeredDialogBounds(width: number, height: number, minW: number, minH: number): DialogBounds {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(width, Math.floor(vw * 0.96))
  const h = Math.min(height, Math.floor(vh * 0.92))
  return clampDialogBounds(
    { x: (vw - w) / 2, y: (vh - h) / 2, width: w, height: h },
    minW,
    minH
  )
}

function Modal({
  title,
  children,
  actions,
  wide,
  className,
  bodyClassName,
  onClose,
  floating
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  wide?: boolean
  className?: string
  bodyClassName?: string
  onClose(): void
  floating?: {
    bounds: DialogBounds
    onBoundsLive: (next: DialogBounds) => void
    onBoundsCommit: (next: DialogBounds) => void
    minWidth: number
    minHeight: number
  }
}): JSX.Element {
  const boundsRef = useRef(floating?.bounds)
  const dragRef = useRef<{
    kind: 'move' | ResizeEdge
    startX: number
    startY: number
    orig: DialogBounds
  } | null>(null)
  const endDragRef = useRef<() => void>(() => {})

  useEffect(() => {
    boundsRef.current = floating?.bounds
  }, [floating?.bounds])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const onPointerMove = useCallback(
    (e: PointerEvent): void => {
      const drag = dragRef.current
      const fl = floating
      if (!drag || !fl) return
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      const o = drag.orig
      let next = { ...o }
      if (drag.kind === 'move') {
        next = { ...o, x: o.x + dx, y: o.y + dy }
      } else {
        const edge = drag.kind
        if (edge.includes('e')) next.width = o.width + dx
        if (edge.includes('s')) next.height = o.height + dy
        if (edge.includes('w')) {
          next.width = o.width - dx
          next.x = o.x + dx
        }
        if (edge.includes('n')) {
          next.height = o.height - dy
          next.y = o.y + dy
        }
        if (edge.includes('w') && next.width < fl.minWidth) {
          next.x = o.x + o.width - fl.minWidth
          next.width = fl.minWidth
        }
        if (edge.includes('n') && next.height < fl.minHeight) {
          next.y = o.y + o.height - fl.minHeight
          next.height = fl.minHeight
        }
      }
      fl.onBoundsLive(clampDialogBounds(next, fl.minWidth, fl.minHeight))
    },
    [floating]
  )

  const onPointerUp = useCallback((): void => {
    endDragRef.current()
  }, [])

  useEffect(() => {
    endDragRef.current = (): void => {
      if (!dragRef.current || !floating) return
      dragRef.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      if (boundsRef.current) floating.onBoundsCommit(boundsRef.current)
    }
  }, [onPointerMove, onPointerUp, floating])

  const beginDrag = (kind: 'move' | ResizeEdge, e: ReactPointerEvent): void => {
    if (!floating) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      orig: floating.bounds
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  const modalClass = [
    'modal',
    wide ? 'modal-wide' : '',
    className,
    floating ? 'is-floating' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const bodyClass = ['modal-body', bodyClassName].filter(Boolean).join(' ')
  const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={modalClass}
        role="dialog"
        aria-label={title}
        style={
          floating
            ? {
                left: floating.bounds.x,
                top: floating.bounds.y,
                width: floating.bounds.width,
                height: floating.bounds.height
              }
            : undefined
        }
        onMouseDown={(e) => floating && e.stopPropagation()}
      >
        {floating &&
          edges.map((edge) => (
            <div
              key={edge}
              className={`modal-resize-handle ${edge}`}
              // eslint-disable-next-line react-hooks/refs -- pointer handler; refs are written on drag start
              onPointerDown={(e) => beginDrag(edge, e)}
            />
          ))}
        <div
          className="modal-title modal-title-chrome"
          onPointerDown={floating ? (e) => beginDrag('move', e) : undefined}
        >
          <span className="modal-title-text">{title}</span>
          <button
            type="button"
            className="modal-title-btn"
            aria-label="Close"
            title="Close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className={bodyClass}>{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

export function Dialogs(): JSX.Element | null {
  const dialog = useAppStore((s) => s.dialog)
  const devGateActive = useAppStore((s) => s.devGateActive)
  if (!dialog) return null
  switch (dialog.kind) {
    case 'confirm-permanent-delete':
      return <ConfirmPermanentDelete paths={dialog.paths} />
    case 'confirm-empty-recycle-bin':
      return <ConfirmEmptyRecycleBin />
    case 'confirm-delete-from-recycle-bin':
      return <ConfirmDeleteFromRecycleBin paths={dialog.paths} />
    case 'conflict':
      return <ConflictDialog />
    case 'op-issues':
      return <OpIssuesDialog />
    case 'new-file':
      return <NewFileDialog parent={dialog.parent} />
    case 'clone-git-repo':
      return <CloneGitRepoDialog parent={dialog.parent} />
    case 'paste-name':
      return <PasteNameDialog destDir={dialog.destDir} format={dialog.format} />
    case 'manage-templates':
      return <ManageTemplatesDialog />
    case 'create-link':
      return <CreateLinkDialog source={dialog.source} />
    case 'view-preset-name':
      return <ViewPresetNameDialog />
    case 'properties':
      return <PropertiesDialog path={dialog.path} />
    case 'usn-manager':
      return <UsnManager path={dialog.path} />
    case 'settings':
      return <SettingsDialog initialSection={dialog.section} />
    case 'categorizer-map':
      return <CategorizerMapManager returnSection={dialog.returnSection} />
    case 'compiled-lists-config':
      return devGateActive ? (
        <CompiledListsConfigDialog returnSection={dialog.returnSection} />
      ) : null
    case 'ads-manager':
      return <AdsManager path={dialog.path} />
    case 'ads-field-column':
      return <AdsFieldColumnDialog />
    case 'layout-name':
      return (
        <LayoutNameDialog
          mode={dialog.mode}
          layoutId={dialog.layoutId}
          initialName={dialog.initialName}
          returnSection={dialog.returnSection}
        />
      )
    case 'tab-icon':
      return <TabIconPickerDialog tabId={dialog.tabId} />
    case 'tab-custom-icon':
      return <TabCustomIconDialog tabId={dialog.tabId} />
    case 'item-note':
      return <ItemNoteDialog path={dialog.path} />
    case 'item-icon':
      return <ItemIconPickerDialog path={dialog.path} />
    case 'alert':
      return (
        <AlertDialog
          title={dialog.title}
          message={dialog.message}
          detail={dialog.detail}
          path={dialog.path}
          lockers={dialog.lockers}
          retryFolderStats={dialog.retryFolderStats}
        />
      )
    case 'confirm':
      return (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
        />
      )
    case 'virtual-folder-conflict':
      return <VirtualFolderConflictDialog title={dialog.title} message={dialog.message} />
    case 'file-op-plan':
      return <FileOpPlanDialog plan={dialog.plan} request={dialog.request} />
    case 'power-rename':
      return <PowerRenameDialog paths={dialog.paths} />
    case 'copy-move-to':
      return <CopyMoveToDialog op={dialog.op} paths={dialog.paths} />
    case 'power-search':
      return <PowerSearchDialog />
    case 'change-cover':
      return <CoverPickerDialog path={dialog.path} />
    case 'media-kind':
      return <MediaKindDialog title={dialog.title} message={dialog.message} />
    case 'media-pick':
      return (
        <MediaPickDialog
          title={dialog.title}
          message={dialog.message}
          candidates={dialog.candidates}
        />
      )
    case 'media-name':
      return (
        <MediaNameDialog
          title={dialog.title}
          message={dialog.message}
          fileName={dialog.fileName}
          suggested={dialog.suggested}
        />
      )
    case 'script-manager':
      return <ScriptManagerDialog selectId={dialog.selectId} />
    case 'script-run':
      return (
        <ScriptRunnerDialog
          scriptId={dialog.scriptId}
          source={dialog.source}
          language={dialog.language}
          name={dialog.name}
          mode={dialog.mode}
          root={dialog.root}
          paths={dialog.paths}
          recursive={dialog.recursive}
          dryRun={dialog.dryRun}
        />
      )
    case 'script-generate':
      return (
        <ScriptGenerateDialog
          mode={dialog.mode}
          folderPath={dialog.folderPath}
          scriptId={dialog.scriptId}
          source={dialog.source}
          language={dialog.language}
          name={dialog.name}
          description={dialog.description}
          recursive={dialog.recursive}
          reviewFix={dialog.reviewFix}
        />
      )
  }
}

function MediaKindDialog({ title, message }: { title: string; message: string }): JSX.Element {
  const resolveMediaKind = useAppStore((s) => s.resolveMediaKind)
  return (
    <Modal
      title={title}
      onClose={() => resolveMediaKind(null)}
      actions={
        <>
          <button className="btn" onClick={() => resolveMediaKind(null)}>
            Skip
          </button>
          <button className="btn" onClick={() => resolveMediaKind('movie')}>
            Movie
          </button>
          <button className="btn primary" onClick={() => resolveMediaKind('show')} autoFocus>
            TV show
          </button>
        </>
      }
    >
      <div className="alert-message">{message}</div>
    </Modal>
  )
}

function MediaNameDialog({
  title,
  message,
  fileName,
  suggested
}: {
  title: string
  message: string
  fileName: string
  suggested: string
}): JSX.Element {
  const resolveMediaName = useAppStore((s) => s.resolveMediaName)
  const [name, setName] = useState(suggested)
  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    resolveMediaName(trimmed)
  }
  const sourceId = parseMediaSourceInput(name)
  return (
    <Modal
      title={title}
      wide
      onClose={() => resolveMediaName(null)}
      actions={
        <>
          <button type="button" className="btn" onClick={() => resolveMediaName(null)}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!name.trim()} onClick={submit}>
            {sourceId ? 'Use this title' : 'Search'}
          </button>
        </>
      }
    >
      <div className="alert-message">{message}</div>
      <p className="dim media-name-file" title={fileName}>
        File: {fileName}
      </p>
      <p className="settings-help">
        This name is sent as typed (scene tags are not stripped). Optional year in parentheses, e.g.
        Title (1999). Or paste a TMDB or IMDb title URL (OMDb uses the IMDb id).
      </p>
      <div className="form-row">
        <label htmlFor="media-search-name">Search as</label>
        <input
          id="media-search-name"
          type="text"
          autoFocus
          value={name}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            e.stopPropagation()
          }}
        />
      </div>
    </Modal>
  )
}

function MediaPickDialog({
  title,
  message,
  candidates
}: {
  title: string
  message: string
  candidates: { id: string; title: string; year?: number; subtitle?: string }[]
}): JSX.Element {
  const resolveMediaPick = useAppStore((s) => s.resolveMediaPick)
  return (
    <Modal
      title={title}
      wide
      onClose={() => resolveMediaPick(null)}
      actions={
        <>
          <button
            type="button"
            className="btn modal-action-start"
            onClick={() => resolveMediaPick({ action: 'search-as' })}
          >
            Search as…
          </button>
          <button type="button" className="btn" onClick={() => resolveMediaPick(null)}>
            Skip
          </button>
        </>
      }
    >
      <div className="alert-message">{message}</div>
      <ul className="media-pick-list">
        {candidates.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="media-pick-item"
              onClick={() => resolveMediaPick({ action: 'pick', id: c.id })}
            >
              <span className="media-pick-title">
                {c.title}
                {c.year != null ? ` (${c.year})` : ''}
              </span>
              {c.subtitle ? <span className="dim media-pick-sub">{c.subtitle}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function LayoutNameDialog({
  mode,
  layoutId,
  initialName,
  returnSection
}: {
  mode: 'save' | 'rename'
  layoutId?: string
  initialName?: string
  returnSection?: string
}): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const saveLayout = useAppStore((s) => s.saveLayout)
  const renameLayoutAction = useAppStore((s) => s.renameLayout)
  const [name, setName] = useState(initialName ?? '')
  const title = mode === 'save' ? 'Save layout' : 'Rename layout'
  const finish = (): void => {
    if (returnSection) openDialog({ kind: 'settings', section: returnSection })
    else closeDialog()
  }
  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (mode === 'save') {
      void saveLayout(trimmed).then((layout) => {
        if (layout) finish()
      })
      return
    }
    if (!layoutId) return
    void renameLayoutAction(layoutId, trimmed).then(finish)
  }
  return (
    <Modal
      title={title}
      onClose={finish}
      actions={
        <>
          <button type="button" className="btn" onClick={finish}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!name.trim()} onClick={submit}>
            {mode === 'save' ? 'Save' : 'Rename'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="layout-name-input">Name</label>
        <input
          id="layout-name-input"
          type="text"
          autoFocus
          value={name}
          placeholder="e.g. AI training, Book editing, Project X"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            e.stopPropagation()
          }}
        />
      </div>
      {mode === 'save' && (
        <p className="settings-help" style={{ marginTop: 10 }}>
          Saves the current tabs (paths, titles, view/sort, tree expand, scoped roots) and pane
          widths. History and selection are not stored.
        </p>
      )}
    </Modal>
  )
}

function AlertDialog({
  title,
  message,
  detail,
  path,
  lockers,
  retryFolderStats
}: {
  title: string
  message: string
  detail?: string
  path?: string
  lockers?: import('@shared/schemas/lockers').LockingProcess[]
  retryFolderStats?: { path: string }
}): JSX.Element {
  const close = (): void => useAppStore.setState({ dialog: null })
  const [propsBusy, setPropsBusy] = useState(false)
  const [propsError, setPropsError] = useState<string | null>(null)
  const showLockers = Boolean(path && (lockers !== undefined || /open in another program|in use by another program/i.test(message)))
  const openWindowsProperties = async (): Promise<void> => {
    if (!path || propsBusy) return
    setPropsBusy(true)
    setPropsError(null)
    try {
      await call(api.shell.showProperties({ path }))
    } catch (e: unknown) {
      setPropsError(e instanceof Error ? e.message : String(e))
    } finally {
      setPropsBusy(false)
    }
  }
  const retry = (): void => {
    if (!retryFolderStats) return
    close()
    // Skip folders already tagged so a long walk does not start over.
    void useAppStore.getState().calculateFolderStatistics(retryFolderStats.path, {
      skipTagged: true
    })
  }
  const [skipBusy, setSkipBusy] = useState(false)
  const skipAndContinue = async (skipOnError: boolean): Promise<void> => {
    if (!retryFolderStats || skipBusy) return
    if (!skipOnError && !path) return
    setSkipBusy(true)
    const store = useAppStore.getState()
    const skipPath = path
    const skippingWalkRoot =
      Boolean(skipPath) && samePath(skipPath!, retryFolderStats.path)
    try {
      // Persist omit for a failed subfolder. Do not put the walk root on the skip
      // list when Skip all continues — that would abort the resume with a validation error.
      if (skipPath && (!skippingWalkRoot || !skipOnError)) {
        try {
          await store.applySettingsPatch({
            folderStatsSkipPaths: addFolderStatsSkipPath(
              store.settings.folderStatsSkipPaths,
              skipPath
            )
          })
        } catch {
          // Still resume via extraSkipPaths so a settings write glitch cannot trap the dialog.
        }
      }
      close()
      if (!skipOnError && skippingWalkRoot) {
        store.notify('Folder added to the Calculate Statistics skip list')
        return
      }
      void store.calculateFolderStatistics(retryFolderStats.path, {
        skipTagged: true,
        ...(skipOnError ? { skipOnError: true } : {}),
        ...(skipPath && !skippingWalkRoot ? { extraSkipPaths: [skipPath] } : {})
      })
    } finally {
      setSkipBusy(false)
    }
  }
  return (
    <Modal
      title={title}
      onClose={close}
      actions={
        <>
          {path ? (
            <button
              type="button"
              className="btn"
              disabled={propsBusy}
              onClick={() => void openWindowsProperties()}
            >
              Windows Properties
            </button>
          ) : null}
          {retryFolderStats ? (
            <button type="button" className="btn" onClick={retry}>
              Retry
            </button>
          ) : null}
          {retryFolderStats && path ? (
            <button
              type="button"
              className="btn"
              disabled={skipBusy}
              onClick={() => void skipAndContinue(false)}
            >
              Skip folder
            </button>
          ) : null}
          {retryFolderStats ? (
            <button
              type="button"
              className="btn"
              disabled={skipBusy}
              onClick={() => void skipAndContinue(true)}
            >
              Skip all
            </button>
          ) : null}
          <button type="button" className="btn primary" onClick={close} autoFocus={!showLockers}>
            OK
          </button>
        </>
      }
    >
      <div className="alert-message">{message}</div>
      {detail ? <div className="alert-detail">{detail}</div> : null}
      {showLockers && path ? (
        <FileLockersPanel path={path} initialLockers={lockers} />
      ) : null}
      {propsError ? <div className="alert-detail">{propsError}</div> : null}
    </Modal>
  )
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger
}: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}): JSX.Element {
  const resolveConfirm = useAppStore((s) => s.resolveConfirm)
  return (
    <Modal
      title={title}
      onClose={() => resolveConfirm(false)}
      actions={
        <>
          <button className="btn" onClick={() => resolveConfirm(false)}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            onClick={() => resolveConfirm(true)}
            autoFocus
          >
            {confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <div className="alert-message">{message}</div>
    </Modal>
  )
}

function VirtualFolderConflictDialog({
  title,
  message
}: {
  title: string
  message: string
}): JSX.Element {
  const resolve = useAppStore((s) => s.resolveVirtualFolderConflict)
  return (
    <Modal
      title={title}
      onClose={() => resolve('cancel')}
      actions={
        <>
          <button className="btn" onClick={() => resolve('cancel')}>
            Cancel
          </button>
          <button className="btn" onClick={() => resolve('reload')}>
            Reload
          </button>
          <button className="btn primary" onClick={() => resolve('overwrite')} autoFocus>
            Overwrite
          </button>
        </>
      }
    >
      <div className="alert-message">{message}</div>
    </Modal>
  )
}

function ConfirmPermanentDelete({ paths }: { paths: string[] }): JSX.Element {
  const confirmPermanentDelete = useAppStore((s) => s.confirmPermanentDelete)
  return (
    <Modal
      title="Delete permanently?"
      onClose={() => void confirmPermanentDelete(false)}
      actions={
        <>
          <button className="btn" onClick={() => void confirmPermanentDelete(false)}>
            Cancel
          </button>
          <button
            className="btn danger"
            autoFocus
            onClick={() => void confirmPermanentDelete(true)}
          >
            Delete permanently
          </button>
        </>
      }
    >
      <p>
        {paths.length === 1
          ? `"${basename(paths[0]!)}" will be permanently deleted.`
          : `${paths.length} items will be permanently deleted.`}
      </p>
      <p className="dim">This cannot be undone — items skip the Recycle Bin.</p>
    </Modal>
  )
}

function ConfirmEmptyRecycleBin(): JSX.Element {
  const confirmEmptyRecycleBin = useAppStore((s) => s.confirmEmptyRecycleBin)
  const recycleBin = useAppStore((s) => s.recycleBin)
  const known = recycleBin.active && !recycleBin.loading
  const count = recycleBin.items.length
  const body = !known
    ? 'Permanently delete all items in the Recycle Bin?'
    : count === 1
      ? 'Permanently delete the 1 item in the Recycle Bin?'
      : `Permanently delete all ${count} items in the Recycle Bin?`
  return (
    <Modal
      title="Empty Recycle Bin?"
      onClose={() => void confirmEmptyRecycleBin(false)}
      actions={
        <>
          <button className="btn" onClick={() => void confirmEmptyRecycleBin(false)}>
            Cancel
          </button>
          <button
            className="btn danger"
            autoFocus
            onClick={() => void confirmEmptyRecycleBin(true)}
          >
            Empty Recycle Bin
          </button>
        </>
      }
    >
      <p>{body}</p>
      <p className="dim">This cannot be undone.</p>
    </Modal>
  )
}

function ConfirmDeleteFromRecycleBin({ paths }: { paths: string[] }): JSX.Element {
  const confirmDeleteFromRecycleBin = useAppStore((s) => s.confirmDeleteFromRecycleBin)
  const binItems = useAppStore((s) => s.recycleBin.items)
  const singleName =
    paths.length === 1
      ? (binItems.find(
          (i) => samePath(i.recyclePath, paths[0]!) || samePath(i.originalPath, paths[0]!)
        )?.name ?? basename(paths[0]!))
      : null
  return (
    <Modal
      title="Delete from Recycle Bin?"
      onClose={() => void confirmDeleteFromRecycleBin(false)}
      actions={
        <>
          <button className="btn" onClick={() => void confirmDeleteFromRecycleBin(false)}>
            Cancel
          </button>
          <button
            className="btn danger"
            autoFocus
            onClick={() => void confirmDeleteFromRecycleBin(true)}
          >
            Delete permanently
          </button>
        </>
      }
    >
      <p>
        {singleName
          ? `“${singleName}” will be permanently removed from the Recycle Bin.`
          : `${paths.length} items will be permanently removed from the Recycle Bin.`}
      </p>
      <p className="dim">This cannot be undone.</p>
    </Modal>
  )
}

function conflictTypeLabel(side: ConflictSide): string {
  if (side.kind === 'dir') return 'Folder'
  if (!side.ext) return side.kind === 'file' ? 'File' : 'Unknown'
  return side.ext.toUpperCase()
}

function ConflictSideCard({
  label,
  side,
  peer
}: {
  label: string
  side: ConflictSide
  peer: ConflictSide
}): JSX.Element {
  const isDir = side.kind === 'dir'
  const showImage = !isDir && isImageExt(side.ext)
  const newer = side.mtimeMs > 0 && side.mtimeMs > peer.mtimeMs
  const larger = !isDir && side.size > 0 && side.size > peer.size
  const dims =
    side.width && side.height ? `${side.width} × ${side.height}` : null
  const fallbackIcon = createElement(iconForEntry(side.ext, isDir), { size: 48 })

  return (
    <div className="conflict-side">
      <div className="conflict-side-label">{label}</div>
      <div className={`conflict-preview${showImage ? ' is-image' : ''}`}>
        {showImage ? (
          <ThumbImage
            path={side.path}
            mtimeMs={side.mtimeMs}
            size={280}
            fallback={fallbackIcon}
          />
        ) : (
          <ShellIcon path={side.path} size={48} isDir={isDir} />
        )}
      </div>
      <dl className="conflict-meta">
        <div>
          <dt>Name</dt>
          <dd title={side.path}>{basename(side.path)}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{conflictTypeLabel(side)}</dd>
        </div>
        {!isDir && (
          <div>
            <dt>Size</dt>
            <dd className={larger ? 'conflict-hilite' : undefined}>
              {formatBytes(side.size)}
              {larger ? ' · larger' : ''}
            </dd>
          </div>
        )}
        {dims && (
          <div>
            <dt>Dimensions</dt>
            <dd>{dims}</dd>
          </div>
        )}
        <div>
          <dt>Modified</dt>
          <dd className={newer ? 'conflict-hilite' : undefined}>
            {side.mtimeMs ? formatDate(side.mtimeMs) : '—'}
            {newer ? ' · newer' : ''}
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{side.birthtimeMs ? formatDate(side.birthtimeMs) : '—'}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd className="conflict-path" title={side.path}>
            {side.path}
          </dd>
        </div>
      </dl>
    </div>
  )
}

function ConflictDialog(): JSX.Element | null {
  const dialog = useAppStore((s) => s.dialog)
  const resolveConflict = useAppStore((s) => s.resolveConflict)
  const items = dialog?.kind === 'conflict' ? dialog.items : []
  const [index, setIndex] = useState(0)
  const [decisions, setDecisions] = useState<Record<string, ConflictDecision>>({})
  const [applyToRest, setApplyToRest] = useState(false)

  const conflictDest =
    dialog?.kind === 'conflict' ? dialog.destinationDir : null
  useEffect(() => {
    setIndex(0)
    setDecisions({})
    setApplyToRest(false)
  }, [conflictDest])

  if (!dialog || dialog.kind !== 'conflict') return null

  const list: ConflictItem[] =
    items.length > 0
      ? items
      : dialog.conflicts.map((name) => ({
          name,
          source: {
            path: dialog.sources.find((s) => basename(s) === name) ?? name,
            kind: 'file' as const,
            size: 0,
            mtimeMs: 0,
            birthtimeMs: 0,
            ext: name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
            width: null,
            height: null
          },
          destination: {
            path: `${dialog.destinationDir}\\${name}`,
            kind: 'file' as const,
            size: 0,
            mtimeMs: 0,
            birthtimeMs: 0,
            ext: name.includes('.') ? name.split('.').pop()!.toLowerCase() : '',
            width: null,
            height: null
          }
        }))

  const current = list[Math.min(index, list.length - 1)]!
  const decidedCount = Object.keys(decisions).length

  const decideCurrent = (decision: ConflictDecision): void => {
    if (applyToRest) {
      const next: Record<string, ConflictDecision> = { ...decisions }
      for (const it of list) {
        if (!next[it.name]) next[it.name] = decision
      }
      next[current.name] = decision
      void resolveConflict(next)
      return
    }
    const next = { ...decisions, [current.name]: decision }
    setDecisions(next)
    const nextUndecided = list.findIndex((it, i) => i > index && !next[it.name])
    if (nextUndecided >= 0) {
      setIndex(nextUndecided)
      return
    }
    if (list.every((it) => next[it.name])) {
      void resolveConflict(next)
    }
  }

  return (
    <Modal
      title={
        list.length === 1
          ? 'File already exists'
          : `Name conflict ${index + 1} of ${list.length}`
      }
      wide
      className="modal-conflict"
      bodyClassName="modal-body-conflict"
      onClose={() => void resolveConflict(null)}
      actions={
        <>
          <button className="btn" onClick={() => void resolveConflict(null)}>
            Cancel
          </button>
          <div className="conflict-actions-grow" />
          {list.length > 1 && (
            <>
              <button
                className="btn"
                title="Skip every conflicting file"
                onClick={() => void resolveConflict('skip')}
              >
                Skip all
              </button>
              <button
                className="btn"
                title="Keep both for every conflict (rename incoming)"
                onClick={() => void resolveConflict('rename')}
              >
                Keep both all
              </button>
              <button
                className="btn"
                title="Replace every conflicting file"
                onClick={() => void resolveConflict('replace')}
              >
                Replace all
              </button>
            </>
          )}
          <button className="btn" onClick={() => decideCurrent('skip')}>
            Skip
          </button>
          <button className="btn" onClick={() => decideCurrent('rename')}>
            Keep both
          </button>
          <button className="btn primary" autoFocus onClick={() => decideCurrent('replace')}>
            Replace
          </button>
        </>
      }
    >
      <p className="conflict-lead">
        {dialog.op === 'move' ? 'Moving' : 'Copying'} into{' '}
        <code>{dialog.destinationDir}</code> — compare the incoming file with what’s already there.
      </p>

      {list.length > 1 && (
        <div className="conflict-picker">
          {list.map((it, i) => (
            <button
              key={it.name}
              type="button"
              className={`conflict-picker-item${i === index ? ' active' : ''}${
                decisions[it.name] ? ' decided' : ''
              }`}
              onClick={() => setIndex(i)}
              title={decisions[it.name] ? `Decided: ${decisions[it.name]}` : it.name}
            >
              <span className="conflict-picker-name">{it.name}</span>
              {decisions[it.name] && (
                <span className="conflict-picker-dec">{decisions[it.name]}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="conflict-compare">
        <ConflictSideCard label="Incoming" side={current.source} peer={current.destination} />
        <div className="conflict-vs" aria-hidden>
          vs
        </div>
        <ConflictSideCard
          label="Existing in destination"
          side={current.destination}
          peer={current.source}
        />
      </div>

      {list.length > 1 && (
        <label className="conflict-apply-rest">
          <input
            type="checkbox"
            checked={applyToRest}
            onChange={(e) => setApplyToRest(e.target.checked)}
          />
          Apply this choice to all remaining undecided conflicts
          {decidedCount > 0 ? (
            <span className="dim">
              {' '}
              ({decidedCount}/{list.length} decided)
            </span>
          ) : null}
        </label>
      )}
    </Modal>
  )
}

const EMPTY_OP_ISSUES: OpIssue[] = []

function sideFromPath(path: string, mtimeMs?: number): ConflictSide {
  const name = basename(path)
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return {
    path,
    kind: 'file',
    size: 0,
    mtimeMs: mtimeMs ?? 0,
    birthtimeMs: 0,
    ext,
    width: null,
    height: null
  }
}

function OpIssuesDialog(): JSX.Element | null {
  const dialog = useAppStore((s) => s.dialog)
  const resolveOpIssues = useAppStore((s) => s.resolveOpIssues)
  const [expanded, setExpanded] = useState<Partial<Record<OpIssueKind, boolean>>>({})
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [compare, setCompare] = useState<ConflictItem | null>(null)

  const issues = dialog?.kind === 'op-issues' ? dialog.issues : EMPTY_OP_ISSUES
  const destDir = dialog?.kind === 'op-issues' ? dialog.destinationDir : undefined
  const groups = useMemo(() => groupOpIssues(issues), [issues])

  useEffect(() => {
    const first = groups[0]
    if (!first) return
    setExpanded({ [first.kind]: true })
    setFocusKey(issueKey(first.items[0]!))
  }, [groups])

  const focused = useMemo(
    () => issues.find((it) => issueKey(it) === focusKey) ?? null,
    [issues, focusKey]
  )

  useEffect(() => {
    if (!focused || focused.kind !== 'name_conflict') {
      setCompare(null)
      return
    }
    const folder = destDir ?? (focused.dest ? parentOf(focused.dest) : null)
    if (!folder) {
      setCompare(null)
      return
    }
    let cancelled = false
    void call(
      api.fs.checkConflicts({
        sources: [focused.source],
        destinationDir: folder,
        ...(focused.dest ? { targets: [focused.dest] } : {})
      })
    )
      .then((r) => {
        if (!cancelled) setCompare(r.items[0] ?? null)
      })
      .catch(() => {
        if (!cancelled) setCompare(null)
      })
    return () => {
      cancelled = true
    }
  }, [focused, destDir])

  if (!dialog || dialog.kind !== 'op-issues') return null

  const applyItems = (subset: OpIssue[], decision: IssueDecision): void => {
    void resolveOpIssues(
      subset.map((it) => ({
        source: it.source,
        dest: it.dest,
        decision,
        sourceMtimeMs: it.sourceMtimeMs,
        destMtimeMs: it.destMtimeMs
      }))
    )
  }

  const opLabel =
    dialog.op === 'copy'
      ? 'Copy'
      : dialog.op === 'move'
        ? 'Move'
        : dialog.op === 'rename'
          ? 'Rename'
          : dialog.op === 'trash'
            ? 'Recycle'
            : 'Delete'

  const showCompare = focused?.kind === 'name_conflict'
  const showLockers = focused?.kind === 'busy'
  const incoming = compare?.source ?? (focused ? sideFromPath(focused.source, focused.sourceMtimeMs) : null)
  const existing =
    compare?.destination ??
    (focused?.dest ? sideFromPath(focused.dest, focused.destMtimeMs) : null)
  const renameOp = dialog?.kind === 'op-issues' && dialog.op === 'rename'
  const folderMerge =
    renameOp && incoming?.kind === 'dir' && existing?.kind === 'dir'

  const patchIssueLockers = (source: string, dest: string | undefined, lockers: OpIssue['lockers']): void => {
    useAppStore.setState((s) => {
      if (s.dialog?.kind !== 'op-issues') return s
      return {
        dialog: {
          ...s.dialog,
          issues: s.dialog.issues.map((it) =>
            it.source === source && (it.dest ?? '') === (dest ?? '') ? { ...it, lockers } : it
          )
        }
      }
    })
  }

  return (
    <Modal
      title={`${opLabel} review — ${issues.length.toLocaleString()} need attention`}
      wide
      className="modal-op-issues"
      bodyClassName="modal-body-op-issues"
      onClose={() => void resolveOpIssues(null)}
      actions={
        <>
          <button className="btn" onClick={() => void resolveOpIssues(null)}>
            Skip remaining
          </button>
          <div className="conflict-actions-grow" />
          <span className="dim">
            {dialog.doneCount.toLocaleString()} completed
            {dialog.destinationDir ? (
              <>
                {' '}
                · <code>{dialog.destinationDir}</code>
              </>
            ) : null}
          </span>
        </>
      }
    >
      <p className="conflict-lead">
        {renameOp && focused?.dest ? (
          <>
            Rename <code>{basename(focused.source)}</code> to{' '}
            <code>{basename(focused.dest)}</code> — that name is already used. Incoming is the
            item you renamed; existing is the name you typed.
          </>
        ) : showLockers ? (
          <>
            These items are in use. End the locking task(s) below (or close the program yourself),
            then <strong>Retry</strong>. Expand a group to choose per item.
          </>
        ) : (
          <>
            Everything that could proceed already did. Decide what to do with the rest — apply to all
            similar, or expand a group to choose per item.
          </>
        )}
      </p>

      <div className="op-issues-groups">
        {groups.map((g) => {
          const open = Boolean(expanded[g.kind])
          const actions = actionsForKind(g.kind)
          return (
            <section key={g.kind} className="op-issues-group">
              <header className="op-issues-group-head">
                <button
                  type="button"
                  className="op-issues-group-toggle"
                  aria-expanded={open}
                  onClick={() => setExpanded((prev) => ({ ...prev, [g.kind]: !open }))}
                >
                  <span className="op-issues-group-title">
                    {g.label} · {g.items.length.toLocaleString()}
                  </span>
                </button>
                <div className="op-issues-group-actions">
                  {actions.map((a) => {
                    const label =
                      folderMerge && a.decision === 'replace' ? 'Merge' : a.label
                    return (
                    <button
                      key={a.decision}
                      type="button"
                      className={`btn${a.decision === 'replace' || a.decision === 'retry' ? ' primary' : ''}`}
                      title={
                        folderMerge && a.decision === 'replace'
                          ? 'Move contents into the existing folder, then remove the one you renamed'
                          : `Apply “${label}” to all ${g.label.toLowerCase()}`
                      }
                      onClick={() => applyItems(g.items, a.decision)}
                    >
                      {label} all
                    </button>
                    )
                  })}
                </div>
              </header>
              {open && (
                <ul className="op-issues-rows">
                  {g.items.map((it) => {
                    const key = issueKey(it)
                    const active = key === focusKey
                    const rowMsg = (it.message.split('\n')[0] ?? it.message).trim()
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={`op-issues-row${active ? ' active' : ''}`}
                          onClick={() => setFocusKey(key)}
                        >
                          <span
                            className="op-issues-row-name"
                            title={it.dest ? `${it.source} → ${it.dest}` : it.source}
                          >
                            {renameOp && it.dest
                              ? `${basename(it.source)} → ${basename(it.dest)}`
                              : basename(it.source)}
                          </span>
                          <span className="op-issues-row-msg" title={it.message}>
                            {it.kind === 'busy' && it.lockers && it.lockers.length > 0
                              ? it.lockers.map((p) => p.name).join(', ')
                              : rowMsg}
                          </span>
                        </button>
                        <div className="op-issues-row-actions">
                          {actions.map((a) => {
                            const label =
                              folderMerge && a.decision === 'replace' ? 'Merge' : a.label
                            return (
                            <button
                              key={a.decision}
                              type="button"
                              className="btn"
                              title={
                                folderMerge && a.decision === 'replace'
                                  ? 'Move contents into the existing folder, then remove the one you renamed'
                                  : undefined
                              }
                              onClick={() => applyItems([it], a.decision)}
                            >
                              {label}
                            </button>
                            )
                          })}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      {showLockers && focused ? (
        <FileLockersPanel
          path={focused.source}
          initialLockers={focused.lockers}
          onChanged={() => {
            void call(api.fs.findLockers({ path: focused.source }))
              .then((r) => patchIssueLockers(focused.source, focused.dest, r.lockers))
              .catch(() => undefined)
          }}
        />
      ) : null}

      {showCompare && incoming && existing && (
        <div className="conflict-compare">
          <ConflictSideCard
            label={renameOp ? 'Renaming this' : 'Incoming'}
            side={incoming}
            peer={existing}
          />
          <div className="conflict-vs" aria-hidden>
            vs
          </div>
          <ConflictSideCard
            label={renameOp ? 'Already using that name' : 'Existing in destination'}
            side={existing}
            peer={incoming}
          />
        </div>
      )}
    </Modal>
  )
}

const FILE_TYPES = [
  { ext: '.txt', label: 'Text (.txt)' },
  { ext: '.md', label: 'Markdown (.md)' },
  { ext: '.json', label: 'JSON (.json)' },
  { ext: '', label: 'Custom (type full name)' }
]

function AdsFieldColumnDialog(): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const patchDetailsLayout = useAppStore((s) => s.patchDetailsLayout)
  const listing = useAppStore((s) => s.listing)
  const [label, setLabel] = useState('')
  const [name, setName] = useState('')
  const [found, setFound] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const paths = listing.entries.map((e) => e.path).slice(0, ADS_LIST_NAMES_MANY_MAX_PATHS)
    if (paths.length === 0) {
      setFound([])
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const res = await api.ads.listNamesMany({ paths })
        if (cancelled) return
        if (res.ok) setFound(res.value.names)
        else setFound([])
      } catch {
        if (!cancelled) setFound([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [listing.entries])

  const submit = (): void => {
    const trimmed = name.trim()
    if (!isValidAdsStreamName(trimmed)) {
      setError('Enter a valid stream name (no < > : " / \\ | ? *).')
      return
    }
    const id = adsFieldColumnId(trimmed)
    const s = useAppStore.getState()
    const pretty = label.trim()
    const rest = s.settings.adsFieldColumns.filter((c) => c.stream.toLowerCase() !== trimmed.toLowerCase())
    const catalog = mergeAdsFieldColumns(rest, [
      pretty ? { stream: trimmed, label: pretty } : { stream: trimmed }
    ])
    const owning = resolveFolderView(s.activeTab().path, s.settings.folderViews)
    const cur = (owning?.detailsColumns ?? s.settings.detailsColumns).filter((c) => c.id !== 'folder')
    const next = cur.some((c) => c.id === id)
      ? cur
      : [...cur, { id, width: ADS_FIELD_COLUMN_DEFAULT_WIDTH }]
    void (async () => {
      await applySettingsPatch({ adsFieldColumns: catalog })
      if (next !== cur) await patchDetailsLayout({ detailsColumns: next })
      closeDialog()
    })()
  }

  return (
    <Modal
      title="Single Alternate Data Stream value column"
      onClose={closeDialog}
      actions={
        <>
          <button className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>
            Add column
          </button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="ads-field-label">Display name</label>
        <input
          id="ads-field-label"
          type="text"
          autoFocus
          value={label}
          spellCheck={false}
          placeholder="Optional — defaults to the stream name"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </div>
      <div className="form-row">
        <label htmlFor="ads-field-name">Stream name</label>
        <input
          id="ads-field-name"
          type="text"
          list="ads-field-found"
          value={name}
          spellCheck={false}
          placeholder={loading ? 'Scanning this folder…' : 'e.g. AUTOV2'}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </div>
      <div className="form-row">
        <label htmlFor="ads-field-pick">Found in this folder</label>
        <select
          id="ads-field-pick"
          value={found.includes(name) ? name : ''}
          disabled={loading || found.length === 0}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
        >
          <option value="">
            {loading
              ? 'Scanning…'
              : found.length === 0
                ? 'No alternate streams found'
                : 'Choose a stream…'}
          </option>
          {found.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <datalist id="ads-field-found">
        {found.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {error ? <p className="dim">{error}</p> : null}
    </Modal>
  )
}

function NewFileDialog({ parent }: { parent: string }): JSX.Element {
  const createNewFile = useAppStore((s) => s.createNewFile)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const [name, setName] = useState('New file')
  const [ext, setExt] = useState('.txt')

  const fullName = ext ? `${name}${ext}` : name

  const submit = (): void => {
    if (fullName.trim()) void createNewFile(parent, fullName.trim())
  }

  return (
    <Modal
      title="New file"
      onClose={closeDialog}
      actions={
        <>
          <button className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            Create
          </button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="nf-name">Name</label>
        <input
          id="nf-name"
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          onFocus={(e) => e.target.select()}
        />
      </div>
      <div className="form-row">
        <label htmlFor="nf-type">Type</label>
        <select id="nf-type" value={ext} onChange={(e) => setExt(e.target.value)}>
          {FILE_TYPES.map((t) => (
            <option key={t.label} value={t.ext}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <p className="dim">Will create: {fullName}</p>
    </Modal>
  )
}

function PasteNameDialog({
  destDir,
  format
}: {
  destDir: string
  format: import('@shared/schemas/clipboardPaste').ClipboardPasteFormat
}): JSX.Element {
  const pasteClipboardAs = useAppStore((s) => s.pasteClipboardAs)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const [name, setName] = useState('Clipboard.txt')

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    const withExt = trimmed.toLowerCase().endsWith(`.${format}`) ? trimmed : `${trimmed}.${format}`
    closeDialog()
    void pasteClipboardAs(destDir, format, withExt)
  }

  return (
    <Modal
      title="Paste as file"
      onClose={closeDialog}
      actions={
        <>
          <button className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            Create
          </button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="paste-name">File name</label>
        <input
          id="paste-name"
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </Modal>
  )
}

function ViewPresetNameDialog(): JSX.Element {
  const saveViewPreset = useAppStore((s) => s.saveViewPreset)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const [name, setName] = useState('View preset')

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    closeDialog()
    void saveViewPreset(trimmed)
  }

  return (
    <Modal
      title="Save view preset"
      onClose={closeDialog}
      actions={
        <>
          <button className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            Save
          </button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="vp-name">Name</label>
        <input
          id="vp-name"
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
    </Modal>
  )
}

function ManageTemplatesDialog(): JSX.Element {
  const templates = useAppStore((s) => s.settings.templates)
  const importFileTemplate = useAppStore((s) => s.importFileTemplate)
  const replaceFileTemplate = useAppStore((s) => s.replaceFileTemplate)
  const duplicateFileTemplate = useAppStore((s) => s.duplicateFileTemplate)
  const deleteFileTemplate = useAppStore((s) => s.deleteFileTemplate)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null)

  useEffect(() => {
    if (selectedId && templates.some((t) => t.id === selectedId)) return
    setSelectedId(templates[0]?.id ?? null)
  }, [templates, selectedId])

  const selected = templates.find((t) => t.id === selectedId) ?? null
  const selectedIndex = selected ? templates.findIndex((t) => t.id === selected.id) : -1
  const atCap = templates.length >= MAX_FILE_TEMPLATES

  const moveSelected = (dir: -1 | 1): void => {
    if (selectedIndex < 0) return
    const next = selectedIndex + dir
    if (next < 0 || next >= templates.length) return
    const copy = [...templates]
    const [row] = copy.splice(selectedIndex, 1)
    if (!row) return
    copy.splice(next, 0, row)
    void applySettingsPatch({ templates: copy })
  }

  const renameSelected = (name: string): void => {
    if (!selected) return
    const pretty = name.trim().slice(0, 80)
    if (!pretty) return
    void applySettingsPatch({
      templates: templates.map((x) =>
        x.id === selected.id
          ? {
              ...x,
              name: pretty,
              suggestedStem: sanitizeTemplateStem(pretty, x.suggestedStem)
            }
          : x
      )
    })
  }

  return (
    <Modal
      title="Manage Templates"
      wide
      className="modal-templates"
      bodyClassName="template-manage-body"
      onClose={closeDialog}
      actions={
        <>
          <span className="dim template-manage-count">
            {templates.length} / {MAX_FILE_TEMPLATES}
          </span>
          <button className="btn primary" onClick={closeDialog}>
            Done
          </button>
        </>
      }
    >
      <p className="dim template-manage-lead">
        <strong>Input</strong> is the file that gets copied.{' '}
        <strong>Pretty name</strong> is the From Template menu label and the default filename
        (extension stays with the input). Stored with the app, not in the folder you browse.
      </p>
      <div className="template-manage-toolbar">
        <button
          type="button"
          className="btn"
          disabled={atCap}
          title={atCap ? `At most ${MAX_FILE_TEMPLATES} templates` : 'Copy a file into Templates'}
          onClick={() => {
            void importFileTemplate().then((id) => {
              if (id) setSelectedId(id)
            })
          }}
        >
          Add file…
        </button>
        <button
          type="button"
          className="btn"
          title="Move up in the menu"
          disabled={selectedIndex <= 0}
          onClick={() => moveSelected(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn"
          title="Move down in the menu"
          disabled={selectedIndex < 0 || selectedIndex >= templates.length - 1}
          onClick={() => moveSelected(1)}
        >
          ↓
        </button>
        <button
          type="button"
          className="btn"
          disabled={!selected || atCap}
          title="Copy this template (same input, new pretty name)"
          onClick={() => {
            if (!selected) return
            void duplicateFileTemplate(selected.id).then((id) => {
              if (id) setSelectedId(id)
            })
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="btn"
          disabled={!selected}
          onClick={() => {
            if (!selected) return
            if (!window.confirm(`Delete template “${selected.name}”?`)) return
            const idx = selectedIndex
            void deleteFileTemplate(selected.id).then(() => {
              const remaining = useAppStore.getState().settings.templates
              setSelectedId(remaining[Math.min(idx, remaining.length - 1)]?.id ?? null)
            })
          }}
        >
          Delete
        </button>
      </div>
      {templates.length === 0 ? (
        <p className="dim">No templates yet. Add a file, then set a pretty name.</p>
      ) : (
        <div className="template-manage-split">
          <ul className="template-manage-list" role="listbox" aria-label="Templates">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={t.id === selectedId}
                  className={
                    'template-manage-item' + (t.id === selectedId ? ' is-selected' : '')
                  }
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="template-manage-item-name">{t.name}</span>
                  <span className="template-manage-item-meta">{templateCreatedName(t)}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <TemplateManageDetail
              key={selected.id}
              template={selected}
              onRename={renameSelected}
              onReplace={() => void replaceFileTemplate(selected.id)}
            />
          ) : null}
        </div>
      )}
    </Modal>
  )
}

function TemplateManageDetail({
  template,
  onRename,
  onReplace
}: {
  template: import('@shared/schemas/templates').FileTemplate
  onRename: (name: string) => void
  onReplace: () => void
}): JSX.Element {
  const [name, setName] = useState(template.name)
  useEffect(() => {
    setName(template.name)
  }, [template.id, template.name])

  const commit = (): void => {
    const next = name.trim().slice(0, 80)
    if (!next) {
      setName(template.name)
      return
    }
    if (next !== template.name) onRename(next)
  }

  const preview = templateCreatedName({
    ...template,
    name: name.trim() || template.name
  })

  return (
    <div className="template-manage-detail">
      <div className="form-row">
        <label htmlFor="tpl-pretty">Pretty name</label>
        <input
          id="tpl-pretty"
          type="text"
          value={name}
          maxLength={80}
          autoFocus
          title="Menu label and default filename (without extension)"
          onChange={(e) => setName(e.target.value.slice(0, 80))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      </div>
      <div className="form-row">
        <label htmlFor="tpl-input">Input file</label>
        <div className="template-manage-input-row">
          <span id="tpl-input" className="template-manage-input" title={templateInputLabel(template)}>
            {templateInputLabel(template)}
          </span>
          <button type="button" className="btn" onClick={onReplace} title="Pick a different file">
            Replace…
          </button>
        </div>
      </div>
      <div className="form-row">
        <label>Creates as</label>
        <span className="template-manage-creates" title={`Extension ${templateExt(template) || '(none)'}`}>
          {preview}
        </span>
      </div>
    </div>
  )
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.min(100, Math.max(0, (part / whole) * 100))
}

function PropsValue({ value }: { value: string }): JSX.Element {
  return (
    <input
      className="props-value"
      type="text"
      readOnly
      value={value}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
    />
  )
}

const PROPS_MIN_W = 420
const PROPS_MIN_H = 360
const PROPS_DEFAULT_W = 520
const PROPS_DEFAULT_H = 560

function PropertiesDialog({ path }: { path: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const platform = useAppStore((s) => s.platform)
  const refresh = useAppStore((s) => s.refresh)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const savedBounds = useAppStore((s) => s.settings.propertiesBounds)
  const [bounds, setBounds] = useState<DialogBounds>(() =>
    savedBounds
      ? clampDialogBounds(savedBounds, PROPS_MIN_W, PROPS_MIN_H)
      : centeredDialogBounds(PROPS_DEFAULT_W, PROPS_DEFAULT_H, PROPS_MIN_W, PROPS_MIN_H)
  )

  useEffect(() => {
    const onResize = (): void => setBounds((b) => clampDialogBounds(b, PROPS_MIN_W, PROPS_MIN_H))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [model, setModel] = useState<PropertiesModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [measure, setMeasure] = useState<FolderMeasureResult | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [attrBusy, setAttrBusy] = useState(false)
  const [attrError, setAttrError] = useState<string | null>(null)
  const [sysPropsBusy, setSysPropsBusy] = useState(false)
  const [sysPropsError, setSysPropsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setModel(null)
    setMeasure(null)
    setError(null)
    setAttrError(null)
    void call(api.fs.properties({ path }))
      .then((m) => {
        if (!cancelled) setModel(m)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(() => {
    if (!model?.canMeasure) return
    let cancelled = false
    setMeasuring(true)
    void call(api.fs.measureFolder({ path: model.path }))
      .then((m) => {
        if (!cancelled) setMeasure(m)
      })
      .catch(() => {
        if (!cancelled) setMeasure(null)
      })
      .finally(() => {
        if (!cancelled) setMeasuring(false)
      })
    return () => {
      cancelled = true
    }
  }, [model?.path, model?.canMeasure])

  const title = model
    ? `${model.kind === 'drive' ? 'Drive' : model.kind === 'dir' ? 'Folder' : 'File'} Properties`
    : 'Properties'

  const showAttributes = model != null && model.kind !== 'drive' && model.kind !== 'missing'
  const attrsEditable = showAttributes
  const has = (label: string): boolean => !!model?.attributes.includes(label)

  const applyAttributes = async (patch: {
    readOnly?: boolean
    hidden?: boolean
    archive?: boolean
    system?: boolean
  }): Promise<void> => {
    if (!model || !attrsEditable || attrBusy) return
    setAttrBusy(true)
    setAttrError(null)
    try {
      const res = await call(
        api.fs.setAttributes({
          path: model.path,
          readOnly: patch.readOnly ?? has('Read-only'),
          hidden: patch.hidden ?? has('Hidden'),
          archive: patch.archive ?? has('Archive'),
          system: patch.system ?? has('System')
        })
      )
      setModel({ ...model, attributes: res.attributes })
      void refresh()
    } catch (e: unknown) {
      setAttrError(e instanceof Error ? e.message : String(e))
    } finally {
      setAttrBusy(false)
    }
  }

  const sizeText =
    model?.sizeBytes != null
      ? `${formatBytes(model.sizeBytes)} (${model.sizeBytes.toLocaleString()} bytes)`
      : model?.canMeasure
        ? measuring && !measure
          ? 'Calculating…'
          : measure
            ? `${formatBytes(measure.totalBytes)} (${measure.totalBytes.toLocaleString()} bytes)${
                measure.truncated ? ' — partial (large folder)' : ''
              }`
            : '—'
        : null

  const containsText = model?.canMeasure
    ? measuring && !measure
      ? 'Calculating…'
      : measure
        ? `${measure.fileCount.toLocaleString()} files, ${measure.folderCount.toLocaleString()} folders`
        : model.contains
          ? `${model.contains.files.toLocaleString()} files, ${model.contains.folders.toLocaleString()} folders (top level)`
          : '—'
    : model?.contains
      ? `${model.contains.files.toLocaleString()} files, ${model.contains.folders.toLocaleString()} folders (top level)`
      : null

  const openWindowsProperties = async (): Promise<void> => {
    if (!model || model.kind === 'missing' || sysPropsBusy) return
    setSysPropsBusy(true)
    setSysPropsError(null)
    try {
      await call(api.shell.showProperties({ path: model.path }))
    } catch (e: unknown) {
      setSysPropsError(e instanceof Error ? e.message : String(e))
    } finally {
      setSysPropsBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      className="modal-properties"
      onClose={closeDialog}
      floating={{
        bounds,
        onBoundsLive: setBounds,
        onBoundsCommit: (next) => {
          const clamped = clampDialogBounds(next, PROPS_MIN_W, PROPS_MIN_H)
          setBounds(clamped)
          void applySettingsPatch({ propertiesBounds: clamped })
        },
        minWidth: PROPS_MIN_W,
        minHeight: PROPS_MIN_H
      }}
      actions={
        <>
          {model && model.kind !== 'missing' && (
            <div className="modal-action-start props-sys-actions">
              <div className="props-sys-actions-row">
                <button
                  type="button"
                  className="btn"
                  disabled={sysPropsBusy}
                  title="Open the Windows Explorer Properties window (Security, Sharing, …)"
                  onClick={() => void openWindowsProperties()}
                >
                  Windows Properties…
                </button>
                {model.kind === 'drive' && platform === 'win32' && (
                  <button
                    type="button"
                    className="btn"
                    title="View and manage the NTFS USN change journal for this drive"
                    onClick={() => openDialog({ kind: 'usn-manager', path: model.path })}
                  >
                    USN…
                  </button>
                )}
              </div>
              {sysPropsError && <div className="props-attr-error">{sysPropsError}</div>}
            </div>
          )}
          <button type="button" className="btn primary" onClick={closeDialog}>
            Close
          </button>
        </>
      }
    >
      {!model && !error && <p className="dim">Loading…</p>}
      {error && <p className="dim">Could not read properties: {error}</p>}
      {model && (
        <>
          <table className="props-table">
            <tbody>
              <tr>
                <td>Name</td>
                <td>
                  <PropsValue value={model.name} />
                </td>
              </tr>
              {model.drive?.volumeLabel && (
                <tr>
                  <td>Volume label</td>
                  <td>
                    <PropsValue value={model.drive.volumeLabel} />
                  </td>
                </tr>
              )}
              <tr>
                <td>Type</td>
                <td>
                  <PropsValue value={model.typeLabel} />
                </td>
              </tr>
              {model.location && (
                <tr>
                  <td>Location</td>
                  <td>
                    <PropsValue value={model.location} />
                  </td>
                </tr>
              )}
              <tr>
                <td>Path</td>
                <td>
                  <PropsValue value={model.path} />
                </td>
              </tr>
              {model.linkTarget && (
                <tr>
                  <td>Link target</td>
                  <td>
                    <PropsValue value={model.linkTarget} />
                  </td>
                </tr>
              )}
              {sizeText != null && (
                <tr>
                  <td>Size</td>
                  <td>
                    <PropsValue value={sizeText} />
                  </td>
                </tr>
              )}
              {containsText != null && (
                <tr>
                  <td>Contains</td>
                  <td>
                    <PropsValue value={containsText} />
                  </td>
                </tr>
              )}
              {model.createdMs != null && (
                <tr>
                  <td>Created</td>
                  <td>
                    <PropsValue value={formatDate(model.createdMs)} />
                  </td>
                </tr>
              )}
              {model.modifiedMs != null && (
                <tr>
                  <td>Modified</td>
                  <td>
                    <PropsValue value={formatDate(model.modifiedMs)} />
                  </td>
                </tr>
              )}
              {model.accessedMs != null && (
                <tr>
                  <td>Accessed</td>
                  <td>
                    <PropsValue value={formatDate(model.accessedMs)} />
                  </td>
                </tr>
              )}
              {showAttributes && (
                <tr>
                  <td>Attributes</td>
                  <td>
                    {attrsEditable ? (
                      <div className="props-attrs">
                        <label className="props-attr">
                          <input
                            type="checkbox"
                            checked={has('Read-only')}
                            disabled={attrBusy}
                            onChange={(e) => void applyAttributes({ readOnly: e.target.checked })}
                          />
                          Read-only
                        </label>
                        <label className="props-attr">
                          <input
                            type="checkbox"
                            checked={has('Hidden')}
                            disabled={attrBusy}
                            onChange={(e) => void applyAttributes({ hidden: e.target.checked })}
                          />
                          Hidden
                        </label>
                        <label className="props-attr">
                          <input
                            type="checkbox"
                            checked={has('Archive')}
                            disabled={attrBusy}
                            onChange={(e) => void applyAttributes({ archive: e.target.checked })}
                          />
                          Archive
                        </label>
                        <label className="props-attr">
                          <input
                            type="checkbox"
                            checked={has('System')}
                            disabled={attrBusy}
                            onChange={(e) => void applyAttributes({ system: e.target.checked })}
                          />
                          System
                        </label>
                        {attrError && <div className="props-attr-error">{attrError}</div>}
                      </div>
                    ) : (
                      <PropsValue value={model.attributes.join(', ') || '—'} />
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {model.drive && (
            <div className="props-drive">
              <div className="form-section">Capacity</div>
              {model.drive.fileSystem && (
                <table className="props-table">
                  <tbody>
                    <tr>
                      <td>File system</td>
                      <td>
                        <PropsValue value={model.drive.fileSystem} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
              <table className="props-capacity-cols">
                <tbody>
                  <tr>
                    <td>Used space</td>
                    <td>{formatBytes(model.drive.usedBytes)}</td>
                    <td>{model.drive.usedBytes.toLocaleString()} bytes</td>
                    <td>{percent(model.drive.usedBytes, model.drive.capacityBytes).toFixed(1)}%</td>
                  </tr>
                  <tr>
                    <td>Free space</td>
                    <td>{formatBytes(model.drive.freeBytes)}</td>
                    <td>{model.drive.freeBytes.toLocaleString()} bytes</td>
                    <td>{percent(model.drive.freeBytes, model.drive.capacityBytes).toFixed(1)}%</td>
                  </tr>
                  <tr>
                    <td>Capacity</td>
                    <td>{formatBytes(model.drive.capacityBytes)}</td>
                    <td>{model.drive.capacityBytes.toLocaleString()} bytes</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <div
                className="props-capacity-bar"
                role="meter"
                aria-label="Disk usage"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(
                  percent(model.drive.usedBytes, model.drive.capacityBytes)
                )}
              >
                <div
                  className="props-capacity-used"
                  style={{
                    width: `${percent(model.drive.usedBytes, model.drive.capacityBytes)}%`
                  }}
                />
              </div>
              <div className="props-capacity-legend">
                <span>
                  <i className="swatch used" /> Used
                </span>
                <span>
                  <i className="swatch free" /> Free
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

const THEME_TOKENS: { key: keyof CustomTheme; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'bgElevated', label: 'Elevated background' },
  { key: 'border', label: 'Border' },
  { key: 'text', label: 'Text' },
  { key: 'textDim', label: 'Dim text' },
  { key: 'accent', label: 'Accent' }
]

function MediaMetadataSettingsPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const mm = settings.mediaMetadata
  const [plex, setPlex] = useState<{
    installed: boolean
    running: boolean
    dataDir: string | null
    tokenFound: boolean
    url: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void api.mediaMetadata.probePlex().then((res) => {
      if (!cancelled && res.ok) setPlex(res.value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="settings-stack">
      <SettingsToggle
        id="set-mm-enabled"
        label="Enable media metadata"
        hint="Off by default. When on: context menu Media Metadata, preview title/cover, folder/video covers from stored streams, and Watched/Genre toolbar filters on folders marked as media containers."
        checked={mm.enabled === true}
        onChange={(v) => void applySettingsPatch({ mediaMetadata: { enabled: v } })}
      />
      <label
        className="settings-field settings-field-narrow"
        htmlFor="set-mm-cover"
        title="Preview poster height in pixels"
      >
        <span>Cover art size</span>
        <div className="settings-inline">
          <SettingsClampedNumber
            id="set-mm-cover"
            value={mm.coverHeightPx}
            min={MEDIA_METADATA_COVER_HEIGHT_MIN}
            max={MEDIA_METADATA_COVER_HEIGHT_MAX}
            onCommit={(v) => void applySettingsPatch({ mediaMetadata: { coverHeightPx: v } })}
          />
          <span className="dim">px tall (preview poster)</span>
        </div>
      </label>
      <SettingsToggle
        id="set-mm-ep-labels"
        label="Show season/episode and title on icon tiles"
        hint="On (default): icon views show S02E01 and the episode title under the thumb. Off: the filename. Details and List always use the filename."
        checked={mm.showEpisodeIconLabels !== false}
        onChange={(v) => void applySettingsPatch({ mediaMetadata: { showEpisodeIconLabels: v } })}
      />
      <SettingsToggle
        id="set-mm-mix-tiles"
        label="Mix folders and files in media libraries"
        hint="Off by default. On: in icon/thumbnail views only, a media-container folder sorts tiles in one A–Z list so cover folders sit next to movie files. List and Details still follow Settings → Behavior → Folders first."
        checked={mm.mixFilesAndFolders}
        onChange={(v) => void applySettingsPatch({ mediaMetadata: { mixFilesAndFolders: v } })}
      />
      <p className="settings-help">
        Store movie / TV metadata and a cover on the file or folder as NTFS streams{' '}
        <code>media_metadata</code> and <code>media_metadata_thumbnail</code>. Right-click → Media
        Metadata. On a folder, Extract / Download / Update / Clear walk every video inside.
        Extract and Download skip items that already have metadata; Update refreshes all and
        extracts missing ones from Plex.
      </p>
      <div className="settings-field">
        <span title="Local Plex install used to extract movie/TV metadata onto files as NTFS streams.">
          Plex Media Server
        </span>
        <p className="dim" style={{ margin: '4px 0 8px' }}>
          {plex
            ? `${plex.installed ? 'Found' : 'Not found'}${plex.running ? ' · running' : ' · not running'}${plex.tokenFound ? ' · token available' : ' · no token'}${plex.dataDir ? ` · ${plex.dataDir}` : ''}`
            : 'Checking…'}
        </p>
        <label
          className="settings-labeled-row"
          htmlFor="set-mm-plex-url"
          title="Plex server URL (usually http://127.0.0.1:32400)"
        >
          <span>URL</span>
          <input
            id="set-mm-plex-url"
            type="text"
            value={mm.plexUrl}
            onChange={(e) => void applySettingsPatch({ mediaMetadata: { plexUrl: e.target.value } })}
          />
        </label>
        <label
          className="settings-labeled-row"
          htmlFor="set-mm-plex-token"
          title="Optional. Leave empty to read the token from Preferences.xml"
        >
          <span>Token override</span>
          <input
            id="set-mm-plex-token"
            type="password"
            autoComplete="off"
            placeholder="(auto from Preferences.xml)"
            value={mm.plexToken}
            onChange={(e) =>
              void applySettingsPatch({ mediaMetadata: { plexToken: e.target.value } })
            }
          />
        </label>
        <label
          className="settings-labeled-row"
          htmlFor="set-mm-plex-dir"
          title="Plex data directory. Empty = %LOCALAPPDATA%\Plex Media Server"
        >
          <span>Data folder</span>
          <input
            id="set-mm-plex-dir"
            type="text"
            placeholder="(auto %LOCALAPPDATA%\Plex Media Server)"
            value={mm.plexDataDir}
            onChange={(e) =>
              void applySettingsPatch({ mediaMetadata: { plexDataDir: e.target.value } })
            }
          />
        </label>
      </div>
      <div className="settings-field">
        <span title="TMDB is preferred; OMDb is the IMDb-data fallback. Both need a free API key and are rate-limited.">
          Internet sources
        </span>
        <p className="dim" style={{ margin: '4px 0 8px' }}>
          TMDB (themoviedb.org) is preferred. OMDb (omdbapi.com) is the IMDb-data fallback. Both
          need a free API key. Free keys are rate-limited (OMDb about 1,000/day; TMDB also has a
          short burst limit). If a limit is hit, download stops and a message explains why.
        </p>
        <label
          className="settings-labeled-row"
          htmlFor="set-mm-src"
          title="Which internet catalog to try first when downloading metadata"
        >
          <span>Preferred</span>
          <select
            id="set-mm-src"
            value={mm.internetSource}
            onChange={(e) =>
              void applySettingsPatch({
                mediaMetadata: { internetSource: e.target.value as 'tmdb' | 'omdb' }
              })
            }
          >
            <option value="tmdb">TMDB</option>
            <option value="omdb">OMDb</option>
          </select>
        </label>
        <label
          className="settings-labeled-row"
          htmlFor="set-mm-tmdb"
          title="themoviedb.org API key (stored in settings)"
        >
          <span>TMDB API key</span>
          <input
            id="set-mm-tmdb"
            type="password"
            autoComplete="off"
            value={mm.tmdbApiKey}
            onChange={(e) =>
              void applySettingsPatch({ mediaMetadata: { tmdbApiKey: e.target.value } })
            }
          />
        </label>
        <label
          className="settings-labeled-row"
          htmlFor="set-mm-omdb"
          title="omdbapi.com API key (stored in settings)"
        >
          <span>OMDb API key</span>
          <input
            id="set-mm-omdb"
            type="password"
            autoComplete="off"
            value={mm.omdbApiKey}
            onChange={(e) =>
              void applySettingsPatch({ mediaMetadata: { omdbApiKey: e.target.value } })
            }
          />
        </label>
      </div>
    </div>
  )
}

function SettingsToggle({
  id,
  label,
  hint,
  hintAsTooltip = false,
  className,
  searchTerms,
  checked,
  onChange
}: {
  id: string
  label: string
  hint?: string
  hintAsTooltip?: boolean
  className?: string
  searchTerms?: string
  checked: boolean
  onChange(v: boolean): void
}): JSX.Element {
  return (
    <label
      className={className ?? 'settings-toggle'}
      htmlFor={id}
      title={hint}
      data-settings-search={searchTerms}
    >
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {hint && !hintAsTooltip && <span className="settings-toggle-hint">{hint}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

function UpdateDownloadBar({
  bytesDone,
  bytesTotal,
  fileName
}: {
  bytesDone: number
  bytesTotal: number
  fileName?: string
}): JSX.Element {
  const known = bytesTotal > 0
  const pct = known ? Math.min(100, Math.round((bytesDone / bytesTotal) * 100)) : 0
  const name = fileName || 'installer'
  return (
    <div className="settings-update-dl">
      <div
        className="settings-update-dl-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? pct : undefined}
        aria-label="Downloading update"
      >
        <div
          className={`settings-update-dl-fill${known ? '' : ' indeterminate'}`}
          style={known ? { width: `${pct}%` } : undefined}
        />
      </div>
      <p className="settings-help settings-updates-status">
        {known
          ? `Downloading ${name}… ${formatBytes(bytesDone)} / ${formatBytes(bytesTotal)} (${pct}%)`
          : `Downloading ${name}… ${formatBytes(bytesDone)}`}
      </p>
    </div>
  )
}

function SettingsDialog({ initialSection }: { initialSection?: string }): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const notify = useAppStore((s) => s.notify)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const clearThumbCache = useAppStore((s) => s.clearThumbCache)
  const exportSettingsFile = useAppStore((s) => s.exportSettingsFile)
  const importSettingsFile = useAppStore((s) => s.importSettingsFile)
  const indexRoots = useAppStore((s) => s.indexRoots)
  const indexProgress = useAppStore((s) => s.indexProgress)
  const addIndexRootAction = useAppStore((s) => s.addIndexRootAction)
  const addVolumeRootAction = useAppStore((s) => s.addVolumeRootAction)
  const removeIndexRootAction = useAppStore((s) => s.removeIndexRootAction)
  const reindexAction = useAppStore((s) => s.reindexAction)
  const runSearch = useAppStore((s) => s.runSearch)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const setSearchIndexedOnly = useAppStore((s) => s.setSearchIndexedOnly)
  const knownFolders = useAppStore((s) => s.knownFolders)
  const quickAccessSetting = useAppStore((s) => s.settings.quickAccess)
  const quickAccessPins = useAppStore((s) => s.settings.quickAccessPins)
  const quickAccessHiddenDefaults = useAppStore((s) => s.settings.quickAccessHiddenDefaults)
  const pinQuickAccess = useAppStore((s) => s.pinQuickAccess)
  const unpinQuickAccess = useAppStore((s) => s.unpinQuickAccess)
  const reorderQuickAccess = useAppStore((s) => s.reorderQuickAccess)
  const resetQuickAccess = useAppStore((s) => s.resetQuickAccess)
  const createQuickAccessGroup = useAppStore((s) => s.createQuickAccessGroup)
  const renameQuickAccessGroup = useAppStore((s) => s.renameQuickAccessGroup)
  const deleteQuickAccessGroup = useAppStore((s) => s.deleteQuickAccessGroup)
  const setQuickAccessGroupColor = useAppStore((s) => s.setQuickAccessGroupColor)
  const moveQuickAccessPinToGroup = useAppStore((s) => s.moveQuickAccessPinToGroup)
  const removeFolderCustomization = useAppStore((s) => s.removeFolderCustomization)
  const setFolderViewRecursive = useAppStore((s) => s.setFolderViewRecursive)
  const applyViewPreset = useAppStore((s) => s.applyViewPreset)
  const renameViewPreset = useAppStore((s) => s.renameViewPreset)
  const removeViewPreset = useAppStore((s) => s.removeViewPreset)
  const applyLayout = useAppStore((s) => s.applyLayout)
  const updateLayout = useAppStore((s) => s.updateLayout)
  const removeLayoutAction = useAppStore((s) => s.removeLayout)
  const navigate = useAppStore((s) => s.navigate)
  const startNetworkDiscovery = useAppStore((s) => s.startNetworkDiscovery)
  const openMapNetworkDrive = useAppStore((s) => s.openMapNetworkDrive)
  const openDisconnectNetworkDrive = useAppStore((s) => s.openDisconnectNetworkDrive)
  const networkStatus = useAppStore((s) => s.network.status)
  const folderViews = useAppStore((s) => s.settings.folderViews)
  const layouts = useAppStore((s) => s.settings.layouts)

  const [localComputerName, setLocalComputerName] = useState('')
  const devGateActive = useAppStore((s) => s.devGateActive)
  const devGatePresent = useAppStore((s) => s.devGatePresent)
  const devGateEnable = useAppStore((s) => s.devGateEnable)
  const setDevGateEnable = useAppStore((s) => s.setDevGateEnable)
  const navItems = SETTINGS_NAV
  const startSection = navItems.some((s) => s.id === initialSection)
    ? (initialSection as SettingsSection)
    : 'appearance'
  const [section, setSection] = useState<SettingsSection>(startSection)
  const [searchDraft, setSearchDraft] = useState('')
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('')
  const paneRef = useRef<HTMLDivElement>(null)
  const categorizerMap = useAppStore((s) => s.slideshow.categorizerMap)
  const [filterText, setFilterText] = useState(settings.viewFilterPatterns.join('\n'))
  const [excludeText, setExcludeText] = useState(settings.searchExcludeDirNames.join('\n'))
  const [hideExtText, setHideExtText] = useState(settings.hideNameExtensions.join('\n'))
  const [addingFilter, setAddingFilter] = useState(false)
  const [filterName, setFilterName] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [filterMacro, setFilterMacro] = useState('')
  const [addingBookmark, setAddingBookmark] = useState(false)
  const [bookmarkName, setBookmarkName] = useState('')
  const [bookmarkQuery, setBookmarkQuery] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [userDataPath, setUserDataPath] = useState('')
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [updateCandidate, setUpdateCandidate] = useState<{
    path: string
    downloadUrl?: string
    fileName: string
    version: string | null
    newer: boolean
    sourceKind: 'folder' | 'url'
  } | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateDownload, setUpdateDownload] = useState<{
    bytesDone: number
    bytesTotal: number
    fileName?: string
  } | null>(null)

  useEffect(() => {
    return api.onEvent((event) => {
      if (event.type !== 'update-download-progress') return
      const p = event.payload
      if (p.phase === 'error') {
        setUpdateDownload(null)
        return
      }
      setUpdateDownload({
        bytesDone: p.bytesDone,
        bytesTotal: p.bytesTotal,
        fileName: p.fileName
      })
    })
  }, [])

  useEffect(() => {
    void call(api.app.getVersion())
      .then((r) => setAppVersion(r.version))
      .catch(() => setAppVersion(''))
    void call(api.app.getPath({ name: 'userData' }))
      .then((r) => setUserDataPath(r.path))
      .catch(() => setUserDataPath(''))
  }, [])

  useEffect(() => {
    if (section !== 'network') return
    void call(api.network.localComputerName())
      .then((r) => setLocalComputerName(r.name || ''))
      .catch(() => setLocalComputerName(''))
  }, [section])
  const qaList = useMemo(
    () =>
      materializeQuickAccessList(quickAccessSetting, quickAccessPins, quickAccessHiddenDefaults),
    [quickAccessSetting, quickAccessPins, quickAccessHiddenDefaults]
  )
  const qaEntries = useMemo(() => {
    return buildQuickAccess(knownFolders, flattenQuickAccessTokens(qaList))
  }, [knownFolders, qaList])
  const qaByToken = useMemo(() => {
    const map = new Map<string, (typeof qaEntries)[number]>()
    for (const e of qaEntries) map.set(e.token.toLowerCase(), e)
    return map
  }, [qaEntries])
  const qaGroups = useMemo(() => qaList.filter(isQuickAccessGroup), [qaList])

  const commitFilterPatterns = (): void => {
    void applySettingsPatch({
      viewFilterPatterns: filterText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    })
  }

  const commitSearchExcludePatterns = (): void => {
    void applySettingsPatch({
      searchExcludeDirNames: excludeText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    })
  }

  const commitHideNameExtensions = (): void => {
    void applySettingsPatch({
      hideNameExtensions: hideExtText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    })
  }

  const pickDefaultPath = async (): Promise<void> => {
    const res = await call(api.app.pickFolder())
    if (res.path) void applySettingsPatch({ defaultNewTabPath: res.path })
  }

  const addRoot = async (): Promise<void> => {
    const res = await call(api.app.pickFolder())
    if (res.path) await addIndexRootAction(res.path)
  }

  const addDrive = async (): Promise<void> => {
    const res = await call(api.app.pickFolder())
    if (!res.path) return
    // Prefer drive root of the picked folder
    const m = /^([a-zA-Z]:)/i.exec(res.path)
    await addVolumeRootAction(m ? `${m[1]}\\` : res.path)
  }

  const addQuickAccessFolder = async (): Promise<void> => {
    const res = await call(api.app.pickFolder())
    if (res.path) await pinQuickAccess(res.path)
  }

  const sectionTitle = navItems.find((s) => s.id === section)?.label ?? 'Settings'
  const qaMissingBuiltins = knownFolders.filter(
    (k) => !qaEntries.some((e) => e.builtinId === k.id)
  )
  const searchTokens = useMemo(
    () => settingsSearchTokens(settingsSearchQuery),
    [settingsSearchQuery]
  )
  const visibleNav = useMemo(
    () => filterSettingsNav(navItems, searchTokens),
    [navItems, searchTokens]
  )

  useEffect(() => {
    const t = window.setTimeout(() => setSettingsSearchQuery(searchDraft), SETTINGS_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchDraft])

  useEffect(() => {
    const next = pickSettingsSectionForSearch(section, visibleNav)
    if (next && next !== section) setSection(next)
  }, [section, visibleNav])

  useLayoutEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    applySettingsPaneFilter(pane, searchTokens)
  }, [searchTokens, section, visibleNav.length])

  return (
    <Modal
      title="Settings"
      className="modal-settings"
      bodyClassName="modal-body-settings"
      onClose={closeDialog}
      actions={
        <button className="btn primary" onClick={closeDialog}>
          Close
        </button>
      }
    >
      <div className="settings-shell">
        <div className="settings-search">
          <input
            type="search"
            className="settings-search-input"
            value={searchDraft}
            autoFocus
            spellCheck={false}
            placeholder="Search settings"
            aria-label="Search settings"
            title="Filter settings pages and fields by name"
            onChange={(e) => setSearchDraft(e.target.value)}
          />
          {searchDraft ? (
            <button
              type="button"
              className="settings-search-clear"
              aria-label="Clear settings search"
              onClick={() => {
                setSearchDraft('')
                setSettingsSearchQuery('')
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="settings-shell-main">
        <nav className="settings-nav" aria-label="Settings sections">
          {visibleNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${section === item.id ? ' active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="settings-pane" ref={paneRef}>
          {visibleNav.length === 0 ? (
            <p className="settings-search-empty">
              No settings match “{settingsSearchQuery.trim() || searchDraft.trim()}”.
            </p>
          ) : (
            <h2 className="settings-pane-title">{sectionTitle}</h2>
          )}
          {visibleNav.length > 0 && (
          <>
          {section === 'appearance' && (
            <div className="settings-grid">
              <label
                className="settings-field"
                htmlFor="set-theme"
                title="Dark, Light, or Custom color tokens below"
              >
                <span>Theme</span>
                <select
                  id="set-theme"
                  value={settings.theme}
                  onChange={(e) =>
                    void applySettingsPatch({ theme: e.target.value as typeof settings.theme })
                  }
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label
                className="settings-field"
                htmlFor="set-font"
                title="CSS font-family for the shell (e.g. Segoe UI, Consolas)"
              >
                <span>Font family</span>
                <input
                  id="set-font"
                  type="text"
                  value={settings.fontFamily}
                  onChange={(e) => void applySettingsPatch({ fontFamily: e.target.value })}
                />
              </label>
              <label
                className="settings-field settings-field-narrow"
                htmlFor="set-fontsize"
                title="UI font size in pixels"
              >
                <span>Font size</span>
                <div className="settings-inline">
                  <SettingsClampedNumber
                    id="set-fontsize"
                    value={settings.fontSizePx}
                    min={FONT_SIZE_PX_MIN}
                    max={FONT_SIZE_PX_MAX}
                    onCommit={(v) => void applySettingsPatch({ fontSizePx: v })}
                  />
                  <span className="dim">px</span>
                </div>
              </label>
              <label
                className="settings-field settings-field-narrow"
                htmlFor="set-iconsize"
                title="File and folder icon size in pixels"
              >
                <span>Icon size</span>
                <div className="settings-inline">
                  <SettingsClampedNumber
                    id="set-iconsize"
                    value={settings.iconSizePx}
                    min={ICON_SIZE_PX_MIN}
                    max={ICON_SIZE_PX_MAX}
                    onCommit={(v) => void applySettingsPatch({ iconSizePx: v })}
                  />
                  <span className="dim">px</span>
                </div>
              </label>
              <SettingsToggle
                id="set-tab-equal-width"
                label="Equal-width tabs"
                hint="On: every tab matches the widest label. Off: each tab is only as wide as its title."
                checked={settings.tabEqualWidth}
                onChange={(v) => void applySettingsPatch({ tabEqualWidth: v })}
              />
              <SettingsToggle
                id="set-show-tab-icons"
                label="Show tab icons"
                hint="Hide all tab icons without clearing the ones you set. New tabs still get a default icon stored."
                checked={settings.showTabIcons}
                onChange={(v) => void applySettingsPatch({ showTabIcons: v })}
              />
              <SettingsToggle
                id="set-tree-pin-toggle"
                label="Pin control to hide the folder tree"
                hint="On: pin / unpin on the tree (each pane). Off: a toolbar button between the address bar and view presets (same idea as Show/Hide preview, flipped) — still per pane in multi-pane layouts."
                checked={settings.treePinToggle}
                onChange={(v) => void applySettingsPatch({ treePinToggle: v })}
              />
              <label
                className="settings-field"
                htmlFor="set-recycle-bin-placement"
                title="Where Recycle Bin appears in the shell. Tree row keeps the label; the tab-bar control is icon-only."
              >
                <span>Recycle Bin</span>
                <select
                  id="set-recycle-bin-placement"
                  value={settings.recycleBinPlacement}
                  onChange={(e) =>
                    void applySettingsPatch({
                      recycleBinPlacement: e.target.value as typeof settings.recycleBinPlacement
                    })
                  }
                >
                  <option value="none">Don&apos;t show</option>
                  <option value="tree">Show in Tree</option>
                  <option value="toolbar">Show in Toolbar</option>
                  <option value="both">Show in both Tree and Bar</option>
                </select>
              </label>
              <p className="settings-field-hint settings-field-span">
                Default is both (This PC / Drives tree row after the drive letters, plus a tab-bar
                icon). Don&apos;t show hides both; the Drives header context menu still has Open /
                Empty Recycle Bin.
              </p>
              {devGatePresent && (
                <SettingsToggle
                  id="set-dev-gated-items"
                  label="Show DEV-gated items"
                  hint="Writes ENABLE in DEV.cfg. Extra tools still require this computer’s name to match that file."
                  checked={devGateEnable}
                  onChange={(v) => void setDevGateEnable(v)}
                />
              )}
              {settings.theme === 'custom' && (
                <div className="settings-theme-tokens">
                  {THEME_TOKENS.map(({ key, label }) => (
                    <label
                      className="settings-token"
                      key={key}
                      htmlFor={`theme-${key}`}
                      title={`Custom theme: ${label}`}
                    >
                      <span>{label}</span>
                      <input
                        id={`theme-${key}`}
                        type="color"
                        className="color-swatch-input"
                        value={settings.customTheme[key]}
                        onChange={(e) =>
                          void applySettingsPatch({
                            customTheme: { ...settings.customTheme, [key]: e.target.value }
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'network' && (
            <div className="settings-stack">
              <p className="settings-help">
                Controls the tree <strong>Network</strong> neighborhood. Each discovery pass
                runs up to ~20 seconds. Only reachable computers are listed (offline hosts stay
                hidden). F5 / Ctrl+R and <strong>Refresh Network</strong> rediscover when
                discovery is enabled.
              </p>
              <SettingsToggle
                id="set-net-enabled"
                label="Enable network discovery"
                hint="Off = no LAN discovery at all (boot / F5 / timer / Discover now). Use this to test whether discovery is related to startup freezes. Mapped drives still work."
                checked={settings.networkDiscovery.enabled !== false}
                onChange={(v) => void applySettingsPatch({ networkDiscovery: { enabled: v } })}
              />
              <label
                className="settings-field"
                htmlFor="set-net-mode"
                title="Manual: launch and Refresh only. Automatic: also rediscovers on a timer."
              >
                <span>Discovery mode</span>
                <select
                  id="set-net-mode"
                  value={settings.networkDiscovery.mode}
                  disabled={settings.networkDiscovery.enabled === false}
                  onChange={(e) =>
                    void applySettingsPatch({
                      networkDiscovery: {
                        mode: e.target.value as 'auto' | 'manual'
                      }
                    })
                  }
                >
                  <option value="auto">Automatic (timed refresh)</option>
                  <option value="manual">Manual only</option>
                </select>
                <span className="settings-field-hint">
                  Manual: launch + explicit refresh only. Automatic: also rediscovers on a timer.
                </span>
              </label>
              {settings.networkDiscovery.mode === 'auto' ? (
                <label
                  className="settings-field settings-field-narrow"
                  htmlFor="set-net-interval"
                  title="Minutes between automatic LAN rediscovery (default 5)"
                >
                  <span>Auto refresh every (minutes)</span>
                  <SettingsClampedNumber
                    id="set-net-interval"
                    value={settings.networkDiscovery.intervalMinutes}
                    min={NETWORK_DISCOVERY_INTERVAL_MIN_MINUTES}
                    max={NETWORK_DISCOVERY_INTERVAL_MAX_MINUTES}
                    onCommit={(n) =>
                      void applySettingsPatch({ networkDiscovery: { intervalMinutes: n } })
                    }
                  />
                  <span className="settings-field-hint">
                    {NETWORK_DISCOVERY_INTERVAL_MIN_MINUTES}–
                    {NETWORK_DISCOVERY_INTERVAL_MAX_MINUTES} minutes (default 5)
                  </span>
                </label>
              ) : null}
              <SettingsToggle
                id="set-net-show-local"
                label={
                  localComputerName
                    ? `Show local computer ${localComputerName}`
                    : 'Show local computer'
                }
                hint="Off by default. When on, this PC can appear under Network if discovery finds it."
                checked={settings.networkDiscovery.showLocalComputer}
                onChange={(v) =>
                  void applySettingsPatch({ networkDiscovery: { showLocalComputer: v } })
                }
              />
              <div className="form-section">Actions</div>
              <div className="settings-inline">
                <button
                  type="button"
                  className="btn"
                  title="Run one discovery pass now (up to about 20 seconds)"
                  disabled={
                    settings.networkDiscovery.enabled === false || networkStatus === 'running'
                  }
                  onClick={() => void startNetworkDiscovery()}
                >
                  {networkStatus === 'running' ? 'Discovering…' : 'Discover now'}
                </button>
                <button
                  type="button"
                  className="btn"
                  title="Assign a drive letter to a network share"
                  onClick={() => void openMapNetworkDrive()}
                >
                  Map network drive…
                </button>
                <button
                  type="button"
                  className="btn"
                  title="Disconnect a mapped network drive"
                  onClick={() => void openDisconnectNetworkDrive()}
                >
                  Disconnect…
                </button>
              </div>
            </div>
          )}

          {section === 'remoterepos' && (
            <div className="settings-stack">
              <p className="settings-help">
                Opt-in FTP / FTPS / SFTP bookmarks. When enabled, a toolbar group manages
                connections and a <strong>Remote repositories</strong> tree section appears
                once you have saved at least one. Details:{' '}
                <code>docs/REMOTE_FTP.md</code>.
              </p>
              <SettingsToggle
                id="set-remote-enabled"
                label="Enable remote repositories"
                hint="Off by default. When on: toolbar Select / Add / Edit / Connect. Passwords use OS secret storage."
                checked={settings.remoteRepos.enabled === true}
                onChange={(v) => void applySettingsPatch({ remoteRepos: { enabled: v } })}
              />
            </div>
          )}

          {section === 'slideshow' && (
            <div className="settings-stack">
              <SettingsToggle
                id="set-slideshow-features"
                label="Enable slideshow UI"
                hint="Show slideshow buttons on the toolbar and Start Slideshow on folder menus. Settings below always stay available."
                checked={settings.slideshowFeaturesEnabled}
                onChange={(v) => void applySettingsPatch({ slideshowFeaturesEnabled: v })}
              />
              <label
                className="settings-labeled-row"
                htmlFor="set-ss-delay"
                title="Delay between images (milliseconds)"
              >
                <span>Delay</span>
                <input
                  id="set-ss-delay"
                  type="number"
                  min={0}
                  step={1}
                  value={settings.slideshow.delayMs}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v) && Number.isInteger(v) && v >= 0) {
                      void applySettingsPatch({ slideshow: { delayMs: v } })
                    }
                  }}
                />
              </label>
              <div className="settings-slideshow-order-row">
                <label
                  className="settings-labeled-row"
                  htmlFor="set-ss-order"
                  title="Sort slideshow images by name, file size, image dimensions, or random order"
                >
                  <span>Order</span>
                  <select
                    id="set-ss-order"
                    value={settings.slideshow.order}
                    onChange={(e) =>
                      void applySettingsPatch({
                        slideshow: {
                          order: e.target.value as typeof settings.slideshow.order
                        }
                      })
                    }
                  >
                    <option value="name">Name</option>
                    <option value="size">Size</option>
                    <option value="dimensions">Image dimensions</option>
                    <option value="random">Random</option>
                  </select>
                </label>
                <SettingsToggle
                  id="set-ss-asc"
                  label="Ascending order"
                  hint="Off = descending (ignored for random)"
                  hintAsTooltip
                  checked={settings.slideshow.ascending}
                  onChange={(v) => void applySettingsPatch({ slideshow: { ascending: v } })}
                />
                <SettingsToggle
                  id="set-ss-loop"
                  label="Loop slideshow"
                  hint="Off = stop when reaching the end"
                  hintAsTooltip
                  checked={settings.slideshow.loop}
                  onChange={(v) => void applySettingsPatch({ slideshow: { loop: v } })}
                />
              </div>
              <SettingsToggle
                id="set-ss-title-filename"
                label="Path in title bar"
                hint="Show the current image full path in the window title. During a slideshow, Alt toggles this (remembered for next time)."
                checked={settings.slideshow.titleFilename}
                onChange={(v) => void applySettingsPatch({ slideshow: { titleFilename: v } })}
              />
              {devGateActive && (
              <>
              <SettingsToggle
                id="set-ss-caption"
                label="Draw caption"
                hint="When an image has an NTFS Caption stream, frame the photo in a poster (random entry each view; border and titles use a color hashed from the caption text). Otherwise overlay the filename."
                checked={settings.slideshow.drawCaption}
                onChange={(v) => void applySettingsPatch({ slideshow: { drawCaption: v } })}
              />
              <div className="settings-field">
                <span title="Unloadable slideshow images are moved here (name conflicts rename). Empty = skip only.">
                  Invalid images folder
                </span>
                <p className="dim" style={{ margin: '4px 0 8px' }}>
                  Unloadable / undecodable slideshow images are moved here and removed from the
                  image-list cache so you can review, re-encode, or delete them. Set a folder to
                  enable moves (name conflicts rename).
                </p>
                <div className="settings-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input
                    id="set-ss-invalid-dir"
                    type="text"
                    placeholder="(not set — skip only)"
                    value={settings.slideshow.invalidImagesDir}
                    onChange={(e) =>
                      void applySettingsPatch({ slideshow: { invalidImagesDir: e.target.value } })
                    }
                    style={{ flex: 1, minWidth: 180 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void (async () => {
                        const res = await call(api.app.pickFolder())
                        if (res.path) {
                          void applySettingsPatch({ slideshow: { invalidImagesDir: res.path } })
                        }
                      })()
                    }}
                  >
                    Browse…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!settings.slideshow.invalidImagesDir}
                    onClick={() =>
                      void applySettingsPatch({ slideshow: { invalidImagesDir: '' } })
                    }
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="settings-field">
                <span title="Root for named .dat indexes and !!Lists. When set, a second toolbar slideshow button appears.">
                  Compiled file lists folder
                </span>
                <p className="dim" style={{ margin: '4px 0 8px' }}>
                  Root for named .dat indexes and <code>!!Lists</code> composites (
                  <code>last.txt</code> for resume; Load/Save additional named lists there). When
                  set, a second toolbar slideshow button appears.
                </p>
                <div className="settings-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="(not set)"
                    value={settings.slideshow.compiledFileListsFolder}
                    onChange={(e) =>
                      void applySettingsPatch({
                        slideshow: { compiledFileListsFolder: e.target.value }
                      })
                    }
                    style={{ flex: 1, minWidth: 180 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void (async () => {
                        const res = await call(api.app.pickFolder())
                        if (res.path) {
                          void applySettingsPatch({
                            slideshow: { compiledFileListsFolder: res.path }
                          })
                        }
                      })()
                    }}
                  >
                    Browse…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!settings.slideshow.compiledFileListsFolder}
                    onClick={() =>
                      void applySettingsPatch({ slideshow: { compiledFileListsFolder: '' } })
                    }
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!settings.slideshow.compiledFileListsFolder}
                    onClick={() =>
                      openDialog({ kind: 'compiled-lists-config', returnSection: 'slideshow' })
                    }
                  >
                    Update Lists…
                  </button>
                </div>
              </div>
              </>
              )}
              <div className="settings-field settings-field-separator">
                <span title="Key-to-folder mappings for the slideshow categorizer. Edits save automatically.">
                  Categorizer map
                </span>
                <p className="dim" style={{ margin: '4px 0 8px' }}>
                  {categorizerMap.length > 0
                    ? `${categorizerMap.length} mapping${categorizerMap.length === 1 ? '' : 's'} saved in app settings`
                    : 'No mappings in app settings'}
                </p>
                <div className="settings-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() =>
                      openDialog({ kind: 'categorizer-map', returnSection: 'slideshow' })
                    }
                  >
                    Mapping Manager…
                  </button>
                </div>
                <p className="dim" style={{ marginTop: 8 }}>
                  Mapping Manager edits are saved automatically.
                </p>
              </div>
            </div>
          )}

          {section === 'mediametadata' && <MediaMetadataSettingsPanel />}
          {section === 'git' && (
            <div className="settings-stack">
              <p className="settings-help">
                Optional Git-aware browsing. Off by default. Uses the system Git CLI — never stores
                credentials. Details: <code>docs/GIT.md</code>.
              </p>
              <SettingsToggle
                id="set-git-enabled"
                label="Enable Git integration"
                hint="Discover repos while browsing and show status overlays / toolbar"
                checked={settings.git.enabled}
                onChange={(v) => void applySettingsPatch({ git: { enabled: v } })}
              />
              <label
                className="settings-field"
                htmlFor="set-git-exe"
                title="Optional path to git.exe. Empty = PATH / common Git for Windows locations."
              >
                <span>Git executable</span>
                <div className="settings-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input
                    id="set-git-exe"
                    type="text"
                    placeholder="(auto-detect)"
                    value={settings.git.executablePath}
                    disabled={!settings.git.enabled}
                    onChange={(e) =>
                      void applySettingsPatch({ git: { executablePath: e.target.value } })
                    }
                    style={{ flex: 1, minWidth: 180 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={!settings.git.enabled}
                    onClick={() => {
                      void (async () => {
                        try {
                          const res = await call(api.git.pickExecutable())
                          if (res.path) {
                            void applySettingsPatch({ git: { executablePath: res.path } })
                          }
                        } catch (e) {
                          notify(e instanceof Error ? e.message : String(e), true)
                        }
                      })()
                    }}
                  >
                    Browse…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!settings.git.enabled}
                    onClick={() => {
                      void (async () => {
                        try {
                          const res = await call(
                            api.git.test({
                              executablePath: settings.git.executablePath || undefined
                            })
                          )
                          if (res.found && res.version) {
                            notify(`Git ${res.version}${res.path ? ` — ${res.path}` : ''}`)
                          } else {
                            notify(res.message || 'Git not found', true)
                          }
                        } catch (e) {
                          notify(e instanceof Error ? e.message : String(e), true)
                        }
                      })()
                    }}
                  >
                    Test Git
                  </button>
                </div>
              </label>
              <fieldset
                className="settings-stack"
                style={{ border: 'none', margin: 0, padding: 0 }}
                disabled={!settings.git.enabled}
              >
              <SettingsToggle
                id="set-git-overlays"
                label="Status overlays"
                hint="Colored markers on changed files in the file view"
                checked={settings.git.showOverlays}
                onChange={(v) => void applySettingsPatch({ git: { showOverlays: v } })}
              />
              <SettingsToggle
                id="set-git-folder-ind"
                label="Folder indicators"
                hint="Dot on folders that contain Git changes"
                checked={settings.git.showFolderIndicators}
                onChange={(v) => void applySettingsPatch({ git: { showFolderIndicators: v } })}
              />
              <SettingsToggle
                id="set-git-toolbar"
                label="Toolbar"
                hint="Branch / changes / Commit · Pull · Push when browsing inside a repo"
                checked={settings.git.showToolbar}
                onChange={(v) => void applySettingsPatch({ git: { showToolbar: v } })}
              />
              <SettingsToggle
                id="set-git-changed-count"
                label="Changed count in toolbar"
                checked={settings.git.showChangedCount}
                onChange={(v) => void applySettingsPatch({ git: { showChangedCount: v } })}
              />
              <SettingsToggle
                id="set-git-ignored"
                label="Show ignored files in Changes"
                hint="Include ignored paths in the Changes dialog. File-list overlays always show an I badge for ignored items."
                checked={settings.git.showIgnored}
                onChange={(v) => void applySettingsPatch({ git: { showIgnored: v } })}
              />
              <SettingsToggle
                id="set-git-status-col"
                label="Git status column"
                hint="Details view column (when visible in column layout)"
                checked={settings.git.showStatusColumn}
                onChange={(v) => void applySettingsPatch({ git: { showStatusColumn: v } })}
              />
              <SettingsToggle
                id="set-git-ahead-behind"
                label="Ahead / behind in toolbar"
                checked={settings.git.showAheadBehind}
                onChange={(v) => void applySettingsPatch({ git: { showAheadBehind: v } })}
              />
              <label
                className="settings-labeled-row"
                htmlFor="set-git-debounce"
                title="Debounce for watcher-driven status refresh (ms)"
              >
                <span>Refresh debounce (ms)</span>
                <SettingsClampedNumber
                  id="set-git-debounce"
                  value={settings.git.refreshDebounceMs}
                  min={100}
                  max={5000}
                  title="100–5000 ms"
                  onCommit={(n) => void applySettingsPatch({ git: { refreshDebounceMs: n } })}
                />
              </label>
              <label
                className="settings-labeled-row"
                htmlFor="set-git-history-page"
                title="Commits loaded per page in repo-root history and File history (Load more uses the same size)"
              >
                <span>History page size</span>
                <SettingsClampedNumber
                  id="set-git-history-page"
                  value={settings.git.historyPageSize}
                  min={20}
                  max={500}
                  title="20–500 commits"
                  onCommit={(n) => void applySettingsPatch({ git: { historyPageSize: n } })}
                />
              </label>
              <label
                className="settings-field"
                htmlFor="set-git-diff-exe"
                title="External diff tool. Placeholders: {left} {right} {relativePath} {repoRoot}"
              >
                <span>Diff tool executable</span>
                <div className="settings-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input
                    id="set-git-diff-exe"
                    type="text"
                    placeholder="(not set)"
                    value={settings.git.diffTool.executable}
                    onChange={(e) =>
                      void applySettingsPatch({
                        git: {
                          diffTool: {
                            ...settings.git.diffTool,
                            executable: e.target.value
                          }
                        }
                      })
                    }
                    style={{ flex: 1, minWidth: 180 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void (async () => {
                        try {
                          const res = await call(api.git.pickDiffTool())
                          if (res.path) {
                            void applySettingsPatch({
                              git: {
                                diffTool: {
                                  ...settings.git.diffTool,
                                  executable: res.path
                                }
                              }
                            })
                          }
                        } catch (e) {
                          notify(e instanceof Error ? e.message : String(e), true)
                        }
                      })()
                    }}
                  >
                    Browse…
                  </button>
                </div>
              </label>
              <label className="settings-field" htmlFor="set-git-diff-args">
                <span>Diff tool args</span>
                <input
                  id="set-git-diff-args"
                  type="text"
                  value={settings.git.diffTool.argsTemplate}
                  onChange={(e) =>
                    void applySettingsPatch({
                      git: {
                        diffTool: {
                          ...settings.git.diffTool,
                          argsTemplate: e.target.value
                        }
                      }
                    })
                  }
                />
                <span className="settings-toggle-hint">
                  Placeholders: {'{left}'} {'{right}'} {'{relativePath}'} {'{repoRoot}'}
                </span>
              </label>
              <SettingsToggle
                id="set-git-suspend-large"
                label="Warn on large dirty trees"
                hint="When many changed paths are reported, still show status but treat as a heavy repo"
                checked={settings.git.suspendLargeRepos}
                onChange={(v) => void applySettingsPatch({ git: { suspendLargeRepos: v } })}
              />
              <label
                className="settings-labeled-row"
                htmlFor="set-git-large-threshold"
                title="Changed-path count treated as a large dirty tree"
              >
                <span>Large-repo threshold</span>
                <SettingsClampedNumber
                  id="set-git-large-threshold"
                  value={settings.git.largeRepoFileThreshold}
                  min={10_000}
                  max={5_000_000}
                  title="10 000–5 000 000"
                  onCommit={(n) =>
                    void applySettingsPatch({ git: { largeRepoFileThreshold: n } })
                  }
                />
              </label>
              </fieldset>
            </div>
          )}
          {section === 'ai' && <AiSettingsPanel />}

          {section === 'behavior' && (
            <div className="settings-stack">
              <label
                className="settings-field"
                htmlFor="set-newtab"
                title="Folder opened by New tab. Empty = your home folder."
              >
                <span>Default new-tab path</span>
                <div className="settings-inline">
                  <input
                    id="set-newtab"
                    type="text"
                    placeholder="(home folder)"
                    value={settings.defaultNewTabPath}
                    onChange={(e) => void applySettingsPatch({ defaultNewTabPath: e.target.value })}
                  />
                  <button type="button" className="btn" onClick={() => void pickDefaultPath()}>
                    Browse…
                  </button>
                </div>
              </label>
              <SettingsToggle
                id="set-foldersfirst"
                label="Folders first"
                hint="Sort folders above files in the file view"
                checked={settings.foldersFirst}
                onChange={(v) => void applySettingsPatch({ foldersFirst: v })}
              />
              <SettingsToggle
                id="set-item-checkboxes"
                label="Item check boxes"
                hint="Show check boxes in the file list to select items without holding Ctrl (like classic Explorer)"
                checked={settings.itemCheckboxes}
                onChange={(v) => void applySettingsPatch({ itemCheckboxes: v })}
              />
              <SettingsToggle
                id="set-paste-nonfile"
                label="Paste non-file clipboard as a file"
                hint="When the clipboard is an image, text, URL, or HTML (not copied files), Ctrl+V creates a file in the current folder. Off: Paste does nothing unless files are on the clipboard."
                checked={settings.pasteNonFileClipboard}
                onChange={(v) => void applySettingsPatch({ pasteNonFileClipboard: v })}
              />
              <label
                className="settings-field"
                htmlFor="set-cmdline-shell"
                title="Console opened by Open Command Line here. Click = current user; Shift+click = Administrator (UAC)."
                data-settings-search="cmd powershell console terminal uac admin shell command prompt"
              >
                <span>Open Command Line</span>
                <select
                  id="set-cmdline-shell"
                  value={settings.commandLineShell === 'powershell' ? 'powershell' : 'cmd'}
                  onChange={(e) =>
                    void applySettingsPatch({
                      commandLineShell: e.target.value === 'powershell' ? 'powershell' : 'cmd'
                    })
                  }
                >
                  <option value="cmd">Command Prompt (cmd.exe)</option>
                  <option value="powershell">PowerShell</option>
                </select>
                <span className="settings-field-hint">
                  Click opens as the current user. Shift+click requests Administrator (UAC).
                </span>
              </label>
              <label
                className="settings-field settings-field-narrow"
                htmlFor="set-vidthumbms"
                title="How long each !VIDTHUMB_CACHE strip frame is shown in icon views (default 300 ms)"
              >
                <span>Video thumbnail frame delay (ms)</span>
                <input
                  id="set-vidthumbms"
                  type="number"
                  min={VID_THUMB_FRAME_MS_MIN}
                  max={VID_THUMB_FRAME_MS_MAX}
                  step={50}
                  value={settings.vidThumbFrameMs}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (
                      Number.isInteger(v) &&
                      v >= VID_THUMB_FRAME_MS_MIN &&
                      v <= VID_THUMB_FRAME_MS_MAX
                    ) {
                      void applySettingsPatch({ vidThumbFrameMs: v })
                    }
                  }}
                />
                <span className="settings-field-hint">
                  Time each `!VIDTHUMB_CACHE` strip frame is shown in icon views (default 300)
                </span>
              </label>
              <SettingsToggle
                id="set-preview-autoplay"
                label="Autoplay media in preview"
                hint="Start video/audio when a file is selected (off by default)"
                checked={settings.previewVideoAutoplay === true}
                onChange={(v) => void applySettingsPatch({ previewVideoAutoplay: v })}
              />
              <SettingsToggle
                id="set-confirmdel"
                label="Always confirm permanent delete"
                hint="Ask even for a single file (Shift+Del)"
                checked={settings.confirmPermanentDeleteAlways}
                searchTerms="recycle bin trash shift+del"
                onChange={(v) => void applySettingsPatch({ confirmPermanentDeleteAlways: v })}
              />
              <label
                className="settings-field"
                htmlFor="set-hide-exts"
                title="One extension per line (no dot). Hides “.ext” in the file view only — rename still uses the full name."
              >
                <span>Hide extensions in names</span>
                <textarea
                  id="set-hide-exts"
                  rows={3}
                  spellCheck={false}
                  value={hideExtText}
                  onChange={(e) => setHideExtText(e.target.value)}
                  onBlur={commitHideNameExtensions}
                  aria-label="Extensions to hide from display names"
                  placeholder={'lnk\nurl'}
                />
                <span className="settings-field-hint">
                  One extension per line (no dot). Strips “.ext” from labels in the file view and
                  search — files stay listed. Rename still uses the full name. Default: lnk
                </span>
              </label>
              <SettingsToggle
                id="set-show-folder-stats"
                label="Show folder statistics"
                hint="Size column and Files / Folders columns read Calculate Statistics streams. Off skips those reads so folders show no size — use this to compare listing performance. Calculate Statistics still works."
                checked={settings.showFolderStatistics !== false}
                onChange={(v) => void applySettingsPatch({ showFolderStatistics: v })}
              />
              <label
                className="settings-field"
                htmlFor="set-folder-stats-treemap-leaves"
                title="Space map keeps up to N largest files; the rest are clumped. Run Calculate Statistics again after changing."
              >
                <span>Folder space map max files</span>
                <SettingsClampedNumber
                  id="set-folder-stats-treemap-leaves"
                  value={settings.folderStatsTreemapMaxLeaves ?? 50000}
                  min={100}
                  max={50000}
                  step={50}
                  title="100–50000 files"
                  onCommit={(n) => void applySettingsPatch({ folderStatsTreemapMaxLeaves: n })}
                />
                <span className="settings-field-hint">
                  Space map keeps up to this many largest files (100–50000, default 50000); the rest
                  are clumped as “Other”. If the ADS JSON would exceed ~16 MB, N is reduced
                  automatically. Run Calculate Statistics again after changing (plain click — not
                  Shift+click alone if the old count is still tagged). Type a value or use the
                  steppers.
                </span>
              </label>
              <div className="settings-field settings-field-separator">
                <span title="Folders omitted from Calculate Statistics. They stay visible in the file list.">
                  Calculate Statistics skip list
                </span>
                <p className="settings-help">
                  Folders omitted from Calculate Statistics (Skip folder or Skip all on a
                  permission error). They stay visible in the file list. Remove a path here to tag
                  it again.
                </p>
                {settings.folderStatsSkipPaths.length === 0 ? (
                  <p className="settings-help">No skipped folders.</p>
                ) : (
                  <div className="settings-index-list roots">
                    {settings.folderStatsSkipPaths.map((skipPath) => (
                      <div className="index-root-row" key={skipPath}>
                        <span className="root-path" title={skipPath}>
                          {skipPath}
                        </span>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            void applySettingsPatch({
                              folderStatsSkipPaths: removeFolderStatsSkipPath(
                                settings.folderStatsSkipPaths,
                                skipPath
                              )
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {section === 'contextmenu' && <ContextMenuSettingsPanel />}

          {section === 'quicklaunch' && <QuickLaunchSettingsPanel />}

          {section === 'quickaccess' && (
            <div className="settings-stack">
              <div className="settings-index-head">
                <p className="settings-help">
                  Shortcuts in the folder tree. You can also pin/unpin from the context menu or drop
                  a folder on the Quick access header.
                </p>
                <div className="settings-inline">
                  <button
                    type="button"
                    className="btn"
                    title="Pin a folder to Quick access"
                    onClick={() => void addQuickAccessFolder()}
                  >
                    Add folder…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    title="Create a named group (rename it in the list)"
                    onClick={() => void createQuickAccessGroup(nextQuickAccessGroupName(qaList))}
                  >
                    Add group…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    title="Restore the default Quick access list"
                    onClick={() => void resetQuickAccess()}
                  >
                    Reset defaults
                  </button>
                </div>
              </div>
              {qaList.length === 0 ? (
                <p className="settings-help">No Quick access items. Add a folder or reset defaults.</p>
              ) : (
                <div className="settings-qa-list">
                  {qaList.map((item, index) => {
                    if (isQuickAccessGroup(item)) {
                      return (
                        <div key={item.id} className="settings-qa-group">
                          <div className="settings-qa-row">
                            <div className="settings-qa-meta">
                              <input
                                type="text"
                                className="settings-qa-label-input"
                                value={item.name}
                                aria-label="Group name"
                                onChange={(e) => void renameQuickAccessGroup(item.id, e.target.value)}
                              />
                              <input
                                type="color"
                                value={item.color ?? '#60a5fa'}
                                title="Group color"
                                onChange={(e) =>
                                  void setQuickAccessGroupColor(item.id, e.target.value)
                                }
                              />
                            </div>
                            <div className="settings-qa-actions">
                              <button
                                type="button"
                                className="btn"
                                disabled={index === 0}
                                onClick={() => void reorderQuickAccess(index, index - 1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="btn"
                                disabled={index >= qaList.length - 1}
                                onClick={() => void reorderQuickAccess(index, index + 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => void deleteQuickAccessGroup(item.id)}
                              >
                                Delete group
                              </button>
                            </div>
                          </div>
                          {item.items.map((token) => {
                            const entry = qaByToken.get(token.toLowerCase())
                            if (!entry) return null
                            return (
                              <div className="settings-qa-row settings-qa-nested" key={token}>
                                <div className="settings-qa-meta">
                                  <span className="settings-qa-label">{entry.label}</span>
                                  <span className="settings-qa-path" title={entry.path}>
                                    {entry.path}
                                  </span>
                                </div>
                                <div className="settings-qa-actions">
                                  <select
                                    aria-label={`Move ${entry.label} to group`}
                                    value={item.id}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      void moveQuickAccessPinToGroup(token, v === '' ? null : v)
                                    }}
                                  >
                                    <option value="">Ungrouped</option>
                                    {qaGroups.map((g) => (
                                      <option key={g.id} value={g.id}>
                                        {g.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="btn"
                                    onClick={() => void unpinQuickAccess(entry.path)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    }
                    const entry = qaByToken.get(item.toLowerCase())
                    if (!entry) return null
                    return (
                      <div className="settings-qa-row" key={entry.token}>
                        <div className="settings-qa-meta">
                          <span className="settings-qa-label">{entry.label}</span>
                          <span className="settings-qa-path" title={entry.path}>
                            {entry.path}
                          </span>
                        </div>
                        <div className="settings-qa-actions">
                          <select
                            aria-label={`Move ${entry.label} to group`}
                            value=""
                            onChange={(e) => {
                              const v = e.target.value
                              if (v) void moveQuickAccessPinToGroup(entry.token, v)
                            }}
                          >
                            <option value="">Ungrouped</option>
                            {qaGroups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn"
                            disabled={index === 0}
                            onClick={() => void reorderQuickAccess(index, index - 1)}
                            aria-label={`Move ${entry.label} up`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={index >= qaList.length - 1}
                            onClick={() => void reorderQuickAccess(index, index + 1)}
                            aria-label={`Move ${entry.label} down`}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void unpinQuickAccess(entry.path)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {qaMissingBuiltins.length > 0 && (
                <div className="settings-qa-builtins">
                  <span className="settings-field-hint">Add built-in:</span>
                  {qaMissingBuiltins.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      className="btn"
                      onClick={() => void pinQuickAccess(k.path)}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {section === 'layouts' && (
            <div className="settings-stack">
              <p className="settings-help">
                Named workspaces for different tasks (AI training, book editing, a coding project…).
                Each layout stores the full tab set — folders, custom titles, view/sort, tree
                expand, scoped roots — plus tree/preview widths, multi-pane mode (1 / 2 / 3 / 4), which
                tab sits in each pane, and the 2- and 4-pane splitter positions. Applying a layout
                replaces the current tabs. Per-folder Details customizations (Folder views) stay
                separate.
              </p>
              <div className="settings-qa-actions" style={{ justifyContent: 'flex-start' }}>
                  <button
                    type="button"
                    className="btn primary"
                    title="Save the current tabs, panes, and splitters as a named workspace"
                    onClick={() =>
                    openDialog({
                      kind: 'layout-name',
                      mode: 'save',
                      returnSection: 'layouts'
                    })
                  }
                >
                  Save current as…
                </button>
              </div>
              {layouts.length === 0 ? (
                <p className="settings-help">No saved layouts yet.</p>
              ) : (
                <div className="settings-qa-list">
                  {[...layouts]
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                    .map((entry) => (
                      <div className="settings-qa-row" key={entry.id}>
                        <div className="settings-qa-meta">
                          <span className="settings-qa-label">{entry.name}</span>
                          <span className="settings-field-hint">{layoutSummary(entry)}</span>
                          {formatLayoutUpdatedAt(entry.updatedAt) && (
                            <span className="settings-qa-path">
                              Updated {formatLayoutUpdatedAt(entry.updatedAt)}
                            </span>
                          )}
                        </div>
                        <div className="settings-qa-actions">
                          <button
                            type="button"
                            className="btn primary"
                            onClick={() => {
                              closeDialog()
                              void applyLayout(entry.id)
                            }}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            className="btn"
                            title="Overwrite this layout with the current tabs, panes, and splitter positions"
                            onClick={() => void updateLayout(entry.id)}
                          >
                            Update
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              openDialog({
                                kind: 'layout-name',
                                mode: 'rename',
                                layoutId: entry.id,
                                initialName: entry.name,
                                returnSection: 'layouts'
                              })
                            }
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void removeLayoutAction(entry.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {section === 'folderviews' && (
            <div className="settings-stack">
              <p className="settings-help">
                Persistent view layouts for specific folders (view mode, sort, Details columns). Use
                the context menu “Customize this folder” to add one. Recursive entries also apply to
                subfolders unless a more specific entry exists.
              </p>
              <h3 className="form-section">View presets</h3>
              <p className="settings-help">
                Named view chrome (mode, sort, columns) — not the folder path. Apply from the pane
                View menu. If this folder already has a customization, Apply updates that override
                instead of creating a new one.
              </p>
              {(settings.viewPresets ?? []).length === 0 ? (
                <p className="settings-help">No view presets yet. Save one from the pane View menu.</p>
              ) : (
                <div className="settings-qa-list">
                  {settings.viewPresets.map((p) => (
                    <div className="settings-qa-row" key={p.id}>
                      <div className="settings-qa-meta">
                        <input
                          type="text"
                          className="settings-qa-label-input"
                          value={p.name}
                          onChange={(e) => void renameViewPreset(p.id, e.target.value)}
                        />
                      </div>
                      <div className="settings-qa-actions">
                        <button type="button" className="btn" onClick={() => void applyViewPreset(p.id)}>
                          Apply
                        </button>
                        <button type="button" className="btn" onClick={() => void removeViewPreset(p.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {folderViews.length === 0 ? (
                <p className="settings-help">No customized folders yet.</p>
              ) : (
                <div className="settings-qa-list">
                  {[...folderViews]
                    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }))
                    .map((entry) => (
                      <div className="settings-qa-row" key={entry.path.toLowerCase()}>
                        <div className="settings-qa-meta">
                          <span className="settings-qa-label">
                            {basename(entry.path)}
                            <span className="settings-scope-badge">
                              {entry.recursive ? 'Tree' : 'Folder'}
                            </span>
                          </span>
                          <span className="settings-qa-path" title={entry.path}>
                            {entry.path}
                          </span>
                          <span className="settings-field-hint">{folderViewSummary(entry)}</span>
                        </div>
                        <div className="settings-qa-actions">
                          <button
                            type="button"
                            className="btn"
                            onClick={() =>
                              void setFolderViewRecursive(entry.path, !entry.recursive)
                            }
                            title={
                              entry.recursive
                                ? 'Switch to this folder only'
                                : 'Apply to this folder and subfolders'
                            }
                          >
                            {entry.recursive ? 'Folder only' : 'Include subfolders'}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              closeDialog()
                              void navigate(entry.path)
                            }}
                          >
                            Go to
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void removeFolderCustomization(entry.path)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {section === 'filter' && (
            <div className="settings-stack">
              <p className="settings-help">
                When enabled, hides Windows Hidden items and any pattern matches from the file view,
                tree, and search (view-only — attributes are unchanged). One pattern per line.
                Wildcards: <code>*</code> (any chars), <code>?</code> (one char). Examples:{' '}
                <code>.tmp</code> or <code>*.tmp</code> (by extension), <code>*cache*</code>{' '}
                (partial name), <code>*\node_modules</code> (exact name anywhere),{' '}
                <code>D:\Art\WIP</code> (this folder). Toolbar eye toggles the filter; Hidden
                attribute is in Properties → Attributes.
              </p>
              <SettingsToggle
                id="set-filter-enabled"
                label="Enable view filter"
                hint="When on, hide Windows Hidden items and matching patterns from the file view, tree, and search. Attributes are not changed."
                checked={settings.viewFilterEnabled}
                onChange={(v) => void applySettingsPatch({ viewFilterEnabled: v })}
              />
              <textarea
                className="filter-textarea"
                aria-label="View filter patterns"
                title="One pattern per line. * = any chars, ? = one char. Examples: .tmp, *cache*, *\\node_modules, D:\\folder"
                placeholder={'.tmp\n*.log\n*cache*\n*\\node_modules\nD:\\folder\\foldername'}
                spellCheck={false}
                rows={10}
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onBlur={commitFilterPatterns}
              />
            </div>
          )}

          {section === 'preview' && (
            <div className="settings-stack">
              <SettingsToggle
                id="set-previewdefault"
                label="Show preview by default"
                hint="New sessions open with the preview pane visible"
                checked={settings.previewVisibleDefault}
                onChange={(v) => void applySettingsPatch({ previewVisibleDefault: v })}
              />
              <label
                className="settings-field settings-field-narrow"
                htmlFor="set-maxbytes"
                title="How much of a text, code, Markdown, or HTML file to show (default 2 MiB). Larger files are truncated."
              >
                <span>Max text preview bytes</span>
                <input
                  id="set-maxbytes"
                  type="number"
                  min={1024}
                  step={1024}
                  value={settings.textPreviewMaxBytes}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (v >= 1024) void applySettingsPatch({ textPreviewMaxBytes: v })
                  }}
                />
              </label>
              <p className="settings-help">
                How much of a text, code, Markdown, or HTML file to show (default 2 MiB). Larger
                files are truncated with a warning.
              </p>
              <SettingsToggle
                id="set-preview-wordwrap"
                label="Word wrap text preview"
                hint="Wrap long lines in text, code, Markdown, and HTML source. Also on the preview header."
                checked={settings.previewTextWordWrap === true}
                onChange={(v) => void applySettingsPatch({ previewTextWordWrap: v })}
              />
            </div>
          )}

          {section === 'search' && (
            <div className="settings-stack">
              <div className="settings-index-head">
                <p className="settings-help">
                  {indexRoots.length === 0
                    ? 'No roots indexed yet. Add folders or a drive for fast Everything-style search.'
                    : `${indexRoots.length} indexed root${indexRoots.length === 1 ? '' : 's'} (folder + volume).`}
                </p>
                <div className="settings-inline">
                  <button
                    type="button"
                    className="btn"
                    title="Index a folder (watched for changes)"
                    onClick={() => void addRoot()}
                  >
                    Add folder…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    title="Index a whole NTFS volume (USN when available)"
                    onClick={() => void addDrive()}
                  >
                    Index drive…
                  </button>
                </div>
              </div>
              <div className="settings-index-list roots">
                {indexRoots.length === 0 ? (
                  <div className="settings-help">No indexed roots yet.</div>
                ) : (
                  indexRoots.map((root) => (
                    <div className="index-root-row" key={root.path}>
                      <span className="root-path" title={root.path}>
                        [{root.kind}] {root.path}
                      </span>
                      <span className="root-status">
                        {root.status === 'indexing'
                          ? `indexing… ${indexProgress[root.path] ?? 0}`
                          : `${root.status} · ${root.monitor} · ${root.fileCount.toLocaleString()}`}
                      </span>
                      <button
                        type="button"
                        className="btn"
                        title="Rebuild this root’s index"
                        onClick={() => void reindexAction(root.path)}
                      >
                        Reindex
                      </button>
                      <button
                        type="button"
                        className="btn"
                        title="Stop indexing this root and drop its rows"
                        onClick={() => void removeIndexRootAction(root.path)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
              <label
                className="checkbox-row"
                title="On: find and show Hidden / !VIDTHUMB_CACHE; view filter does not hide search hits. Off: omit Hidden from search; toolbar view filter applies to results when the eye is on. attrib:h still finds them."
              >
                <input
                  type="checkbox"
                  checked={settings.searchShowHidden}
                  onChange={(e) => {
                    void applySettingsPatch({ searchShowHidden: e.target.checked }).then(() => {
                      void runSearch()
                    })
                  }}
                />
                Show hidden files in search
              </label>
              <p className="settings-help">
                Off by default. When off, search skips Windows Hidden items,{' '}
                <code>!VIDTHUMB_CACHE</code>, and anything inside a hidden folder, and the toolbar
                view filter (if on) still clips results. When on, those items can match and every
                hit is shown regardless of the view-filter eye. <code>attrib:h</code> still matches
                hidden files.
              </p>
              <div className="form-section">Exclude from search</div>
              <p className="settings-help">
                Skipped while indexing and live-folder search (same pattern language as View
                filter). One pattern per line. Examples: <code>node_modules</code> (folder name
                anywhere), <code>.git</code> or <code>*.log</code> (extension),{' '}
                <code>Thumbs.db</code> (file name), <code>D:\Art\WIP</code> (this folder).
                Indexed hits already stored are hidden immediately; Reindex a root to drop them
                from the database.
              </p>
              <textarea
                className="filter-textarea"
                aria-label="Search exclude patterns"
                title="One pattern per line. Skipped while indexing and folder search. Already-indexed hits hide immediately; Reindex drops them from the database."
                placeholder={'node_modules\n.git\n*.log\nThumbs.db\nD:\\folder\\skip'}
                spellCheck={false}
                rows={8}
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
                onBlur={commitSearchExcludePatterns}
              />

              <div className="form-section">Saved filters</div>
              <p className="settings-help">
                Name + query (e.g. <code>ext:jpg;png</code>). Optional macro alias becomes{' '}
                <code>alias:</code> in the search box.
              </p>
              {(settings.searchFilters ?? []).map((f) => (
                <div className="index-root-row" key={f.id}>
                  <span className="root-path">
                    {f.name}
                    {f.macro ? ` (${f.macro}:)` : ''} — {f.query}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSearchIndexedOnly(true)
                      setSearchQuery(f.macro ? `${f.macro}:` : f.query)
                      void runSearch()
                      closeDialog()
                    }}
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void applySettingsPatch({
                        searchFilters: settings.searchFilters.filter((x) => x.id !== f.id)
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              {addingFilter ? (
                <div className="settings-add-form">
                  <label
                    className="settings-field"
                    htmlFor="set-filter-name"
                    title="Display name for this saved filter"
                  >
                    <span>Name</span>
                    <input
                      id="set-filter-name"
                      type="text"
                      value={filterName}
                      autoFocus
                      placeholder="Photos"
                      onChange={(e) => setFilterName(e.target.value)}
                    />
                  </label>
                  <label
                    className="settings-field"
                    htmlFor="set-filter-query"
                    title="Everything-style query, e.g. ext:jpg;png"
                  >
                    <span>Query</span>
                    <input
                      id="set-filter-query"
                      type="text"
                      value={filterQuery}
                      placeholder="ext:jpg;png"
                      spellCheck={false}
                      onChange={(e) => setFilterQuery(e.target.value)}
                    />
                  </label>
                  <label
                    className="settings-field"
                    htmlFor="set-filter-macro"
                    title="Optional alias — type alias: in the search box to run this filter"
                  >
                    <span>Macro alias (optional)</span>
                    <input
                      id="set-filter-macro"
                      type="text"
                      value={filterMacro}
                      placeholder="photos"
                      spellCheck={false}
                      onChange={(e) => setFilterMacro(e.target.value)}
                    />
                  </label>
                  <div className="settings-inline">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setAddingFilter(false)
                        setFilterName('')
                        setFilterQuery('')
                        setFilterMacro('')
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!filterName.trim()}
                      onClick={() => {
                        const name = filterName.trim()
                        if (!name) return
                        const macro = filterMacro.trim()
                        void applySettingsPatch({
                          searchFilters: [
                            ...settings.searchFilters,
                            {
                              id: `flt_${Date.now().toString(36)}`,
                              name,
                              query: filterQuery.trim(),
                              ...(macro ? { macro } : {})
                            }
                          ]
                        })
                        setAddingFilter(false)
                        setFilterName('')
                        setFilterQuery('')
                        setFilterMacro('')
                      }}
                    >
                      Save filter
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn" onClick={() => setAddingFilter(true)}>
                  Add filter…
                </button>
              )}

              <div className="form-section">Bookmarks</div>
              {(settings.searchBookmarks ?? []).map((b) => (
                <div className="index-root-row" key={b.id}>
                  <span className="root-path">
                    {b.name} — {b.query}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSearchIndexedOnly(b.scope === 'indexed')
                      setSearchQuery(b.query)
                      void runSearch()
                      closeDialog()
                    }}
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void applySettingsPatch({
                        searchBookmarks: settings.searchBookmarks.filter((x) => x.id !== b.id)
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              {addingBookmark ? (
                <div className="settings-add-form">
                  <label
                    className="settings-field"
                    htmlFor="set-bookmark-name"
                    title="Display name for this bookmark"
                  >
                    <span>Name</span>
                    <input
                      id="set-bookmark-name"
                      type="text"
                      value={bookmarkName}
                      autoFocus
                      placeholder="Recent JPGs"
                      onChange={(e) => setBookmarkName(e.target.value)}
                    />
                  </label>
                  <label
                    className="settings-field"
                    htmlFor="set-bookmark-query"
                    title="Query to run when you open this bookmark"
                  >
                    <span>Query</span>
                    <input
                      id="set-bookmark-query"
                      type="text"
                      value={bookmarkQuery}
                      placeholder="ext:jpg"
                      spellCheck={false}
                      onChange={(e) => setBookmarkQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        const name = bookmarkName.trim()
                        const query = bookmarkQuery.trim()
                        if (!name || !query) return
                        void applySettingsPatch({
                          searchBookmarks: [
                            ...settings.searchBookmarks,
                            {
                              id: `bm_${Date.now().toString(36)}`,
                              name,
                              query,
                              scope: 'indexed'
                            }
                          ]
                        })
                        setAddingBookmark(false)
                        setBookmarkName('')
                        setBookmarkQuery('')
                      }}
                    />
                  </label>
                  <div className="settings-inline">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setAddingBookmark(false)
                        setBookmarkName('')
                        setBookmarkQuery('')
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!bookmarkName.trim() || !bookmarkQuery.trim()}
                      onClick={() => {
                        const name = bookmarkName.trim()
                        const query = bookmarkQuery.trim()
                        if (!name || !query) return
                        void applySettingsPatch({
                          searchBookmarks: [
                            ...settings.searchBookmarks,
                            {
                              id: `bm_${Date.now().toString(36)}`,
                              name,
                              query,
                              scope: 'indexed'
                            }
                          ]
                        })
                        setAddingBookmark(false)
                        setBookmarkName('')
                        setBookmarkQuery('')
                      }}
                    >
                      Save bookmark
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn" onClick={() => setAddingBookmark(true)}>
                  Add bookmark…
                </button>
              )}
            </div>
          )}

          {section === 'advanced' && (
            <div className="settings-stack">
              <SettingsToggle
                id="set-disable-hw-accel"
                label="Disable hardware acceleration"
                hint="Turns off Chromium GPU compositing so this app uses less VRAM (useful while LoRA / CUDA training runs on the same GPU). Slightly softer scrolling; restart required after changing."
                checked={settings.disableHardwareAcceleration}
                onChange={(v) => {
                  void applySettingsPatch({ disableHardwareAcceleration: v })
                  notify(
                    v
                      ? 'Hardware acceleration will turn off after restart'
                      : 'Hardware acceleration will turn on after restart'
                  )
                }}
                searchTerms="gpu vram chromium"
              />

              <div className="form-section">Search HTTP API</div>
              <SettingsToggle
                id="set-search-http"
                label="Enable localhost search API"
                hint="GET http://127.0.0.1:<port>/search?q=…&token=… — indexed roots only. Bind loopback only."
                checked={settings.searchHttpEnabled}
                onChange={(v) => void applySettingsPatch({ searchHttpEnabled: v })}
              />
              <label
                className="settings-field settings-field-narrow"
                htmlFor="set-search-http-port"
                title="Loopback port for GET /search (1024–65535)"
              >
                <span>Port</span>
                <input
                  id="set-search-http-port"
                  type="number"
                  min={1024}
                  max={65535}
                  value={settings.searchHttpPort}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n)) void applySettingsPatch({ searchHttpPort: n })
                  }}
                />
              </label>
              <label
                className="settings-field"
                htmlFor="set-search-http-token"
                title="Required query token (?token=). Leave empty to allow unauthenticated local requests."
              >
                <span>Auth token</span>
                <input
                  id="set-search-http-token"
                  type="text"
                  spellCheck={false}
                  value={settings.searchHttpToken}
                  placeholder="Required when set"
                  onChange={(e) => void applySettingsPatch({ searchHttpToken: e.target.value })}
                />
              </label>

              <div className="settings-action-card">
                <div>
                  <div
                    className="settings-toggle-label"
                    title="Settings, session, and caches for this app. Reinstalling does not clear this folder."
                  >
                    App data
                  </div>
                  <div className="settings-toggle-hint">
                    Settings, session, and caches live here for both <code>npm run dev</code> and
                    the installed app. Reinstalling does not clear this folder.
                  </div>
                  {userDataPath ? (
                    <p className="settings-help">
                      <code>{userDataPath}</code>
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={!userDataPath}
                  onClick={() => {
                    if (!userDataPath) return
                    void call(api.shell.openPath({ path: userDataPath }))
                  }}
                >
                  Open folder
                </button>
              </div>

              <div className="settings-action-card">
                <div>
                  <div
                    className="settings-toggle-label"
                    title="Windows shell icons and image thumbs under app data. They rebuild as you browse."
                  >
                    Icon & thumbnail cache
                  </div>
                  <div className="settings-toggle-hint">
                    Clears Windows shell icons and image thumbs under app data. They rebuild as you
                    browse.
                  </div>
                </div>
                <button type="button" className="btn" onClick={() => void clearThumbCache()}>
                  Clear cache
                </button>
              </div>
            </div>
          )}

          {section === 'about' && (
            <div className="settings-stack">
              <div className="settings-action-card">
                <div>
                  <div className="settings-toggle-label" title="Installed MyFileExplorer version">
                    Current version
                  </div>
                  <div className="settings-version-value">{appVersion || '…'}</div>
                </div>
              </div>

              <div className="settings-action-card">
                <div>
                  <div
                    className="settings-toggle-label"
                    title="README, feature guides, and issue tracker on GitHub"
                  >
                    Help & documentation
                  </div>
                  <div className="settings-toggle-hint">
                    README, feature guides, and issue tracker on the project GitHub page.
                  </div>
                </div>
                <a
                  className="btn"
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the MyFileExplorer GitHub repository in your browser"
                >
                  Open GitHub…
                </a>
              </div>

              <div className="settings-action-card">
                <div className="settings-updates-body">
                  <div
                    className="settings-toggle-label"
                    title="Check GitHub Releases or a local folder of installers"
                  >
                    Updates
                  </div>
                  <div className="settings-toggle-hint">
                    Leave empty (or use the default GitHub Releases URL), or point at a local folder
                    of installers.
                  </div>
                  <label
                    className="settings-labeled-row settings-updates-source"
                    htmlFor="set-updates-folder"
                    title="Empty or the default GitHub Releases URL, or a local folder of installers"
                  >
                    <span>Folder or URL</span>
                    <input
                      id="set-updates-folder"
                      type="text"
                      spellCheck={false}
                      value={settings.updatesFolder}
                      placeholder={DEFAULT_UPDATES_SOURCE}
                      onChange={(e) => void applySettingsPatch({ updatesFolder: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn"
                      title="Browse for a local updates folder"
                      onClick={() => {
                        void (async () => {
                          const res = await call(api.app.pickFolder())
                          if (res.path) {
                            void applySettingsPatch({ updatesFolder: res.path })
                            setUpdateStatus(null)
                            setUpdateCandidate(null)
                          }
                        })()
                      }}
                    >
                      Browse…
                    </button>
                  </label>
                  {updateDownload && updateBusy ? (
                    <UpdateDownloadBar
                      bytesDone={updateDownload.bytesDone}
                      bytesTotal={updateDownload.bytesTotal}
                      fileName={updateDownload.fileName}
                    />
                  ) : (
                    updateStatus && (
                      <p className="settings-help settings-updates-status">{updateStatus}</p>
                    )
                  )}
                </div>
                <div className="settings-btn-stack">
                  <button
                    type="button"
                    className="btn"
                    title="Look for a newer installer at the source above"
                    disabled={updateBusy}
                    onClick={() => {
                      void (async () => {
                        setUpdateBusy(true)
                        setUpdateStatus(null)
                        setUpdateCandidate(null)
                        setUpdateDownload(null)
                        const source = resolveUpdatesSource(settings.updatesFolder)
                        try {
                          const res = await call(api.app.checkUpdate({ source }))
                          if (!res.candidate) {
                            setUpdateStatus(
                              'No MyFileExplorer installer found at that source.'
                            )
                          } else if (res.candidate.newer) {
                            setUpdateCandidate(res.candidate)
                            const where =
                              res.candidate.sourceKind === 'url' ? 'on GitHub' : 'in that folder'
                            setUpdateStatus(
                              res.candidate.version
                                ? `Update available: ${res.candidate.fileName} ${where} (v${res.candidate.version}).`
                                : `Update available: ${res.candidate.fileName} ${where}.`
                            )
                          } else {
                            setUpdateStatus("You're up to date.")
                          }
                        } catch (e) {
                          setUpdateStatus(e instanceof Error ? e.message : String(e))
                        } finally {
                          setUpdateBusy(false)
                        }
                      })()
                    }}
                  >
                    Check for update
                  </button>
                  {updateCandidate?.newer && (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={updateBusy}
                      onClick={() => {
                        if (!updateCandidate?.newer) return
                        void (async () => {
                          setUpdateBusy(true)
                          setUpdateDownload(null)
                          const source = resolveUpdatesSource(settings.updatesFolder)
                          try {
                            if (updateCandidate.downloadUrl) {
                              setUpdateStatus('Downloading installer…')
                            }
                            await call(
                              api.app.runUpdate({
                                path: updateCandidate.path || updateCandidate.fileName,
                                source,
                                downloadUrl: updateCandidate.downloadUrl,
                                version: updateCandidate.version ?? undefined
                              })
                            )
                            setUpdateStatus('Launching installer… the app will close.')
                          } catch (e) {
                            setUpdateDownload(null)
                            setUpdateStatus(e instanceof Error ? e.message : String(e))
                            setUpdateBusy(false)
                          }
                        })()
                      }}
                    >
                      Update
                    </button>
                  )}
                </div>
              </div>

              <div className="settings-action-card">
                <div
                  className="settings-toggle-label settings-action-card-title"
                  title="Portable JSON of preferences. Window positions and secrets (passwords, AI keys) are not included."
                >
                  Export / import settings
                </div>
                <div className="settings-toggle-hint">
                  Save a portable JSON backup of all preferences — including context menu
                  customization (built-in show/hide and order, Discover scan catalog and enabled
                  verbs, Custom files/folders commands), theme, named layouts, folder views,
                  slideshow, network discovery, remembered Network hosts, remote repository
                  connections without passwords, saved scripts (source yes), AI provider
                  metadata (not API keys), and everything else in Settings. Dialog and
                  main-window positions are not included. Import replaces current settings; open
                  tabs are unchanged (apply a named layout to restore a workspace). Re-enter
                  remote passwords and AI keys after import.
                </div>
                <div className="settings-btn-stack">
                  <button
                    type="button"
                    className="btn"
                    title="Save settings to a JSON file"
                    onClick={() => void exportSettingsFile()}
                  >
                    Export…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    title="Replace current settings from a JSON file"
                    onClick={() => void importSettingsFile()}
                  >
                    Import…
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
          )}
        </div>
        </div>
      </div>
    </Modal>
  )
}
