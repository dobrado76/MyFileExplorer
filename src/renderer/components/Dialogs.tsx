import {
  createElement,
  useEffect,
  useMemo,
  useState,
  type JSX,
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
import { formatBytes, formatDate } from '../lib/format'
import { folderViewSummary } from '@shared/folderViews'
import { addFolderStatsSkipPath, removeFolderStatsSkipPath } from '@shared/folderStatsSkip'
import { samePath } from '@shared/paths'
import { formatLayoutUpdatedAt, layoutSummary } from '@shared/layouts'
import { VID_THUMB_FRAME_MS_MAX, VID_THUMB_FRAME_MS_MIN } from '@shared/vidThumbCache'
import { buildQuickAccess, materializeQuickAccessTokens } from '../lib/quickAccess'
import { basename } from '../lib/paths'
import { iconForEntry, isImageExt } from '../lib/icons'
import { DEFAULT_UPDATES_SOURCE, GITHUB_REPO_URL, resolveUpdatesSource } from '@shared/updatesSource'
import { ThumbImage } from './ThumbImage'
import { ShellIcon } from './ShellIcon'
import { TabIconPickerDialog } from './TabIconPickerDialog'
import { CategorizerMapManager } from './CategorizerMapManager'
import { CompiledListsConfigDialog } from './CompiledListsConfigDialog'
import { AdsManager } from './AdsManager'
import { PowerRenameDialog } from './PowerRenameDialog'
import { PowerSearchDialog } from './PowerSearchDialog'
import { CopyMoveToDialog } from './CopyMoveToDialog'
import { ContextMenuSettingsPanel } from './ContextMenuSettingsPanel'
import { CloseIcon } from '../lib/icons'

function Modal({
  title,
  children,
  actions,
  wide,
  className,
  bodyClassName,
  onClose
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  wide?: boolean
  className?: string
  bodyClassName?: string
  onClose(): void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const modalClass = ['modal', wide ? 'modal-wide' : '', className].filter(Boolean).join(' ')
  const bodyClass = ['modal-body', bodyClassName].filter(Boolean).join(' ')

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={modalClass} role="dialog" aria-label={title}>
        <div className="modal-title modal-title-chrome">
          <span className="modal-title-text">{title}</span>
          <button
            type="button"
            className="modal-title-btn"
            aria-label="Close"
            title="Close"
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

/** Typeable number field: draft while editing, clamp + commit on blur / valid values. */
function SettingsClampedNumber({
  id,
  value,
  min,
  max,
  onCommit
}: {
  id: string
  value: number
  min: number
  max: number
  onCommit: (n: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  function clamp(n: number): number {
    return Math.min(max, Math.max(min, Math.round(n)))
  }

  function commitRaw(raw: string): void {
    const n = Number(raw)
    const next = Number.isFinite(n) ? clamp(n) : clamp(value)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <input
      id={id}
      type="number"
      min={min}
      max={max}
      step={1}
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') return
        const n = Number(raw)
        if (Number.isFinite(n) && n >= min && n <= max) onCommit(Math.round(n))
      }}
      onBlur={() => commitRaw(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commitRaw(draft)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
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
    case 'properties':
      return <PropertiesDialog path={dialog.path} />
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
    case 'alert':
      return (
        <AlertDialog
          title={dialog.title}
          message={dialog.message}
          detail={dialog.detail}
          path={dialog.path}
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
    case 'power-rename':
      return <PowerRenameDialog paths={dialog.paths} />
    case 'copy-move-to':
      return <CopyMoveToDialog op={dialog.op} paths={dialog.paths} />
    case 'power-search':
      return <PowerSearchDialog />
  }
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
  retryFolderStats
}: {
  title: string
  message: string
  detail?: string
  path?: string
  retryFolderStats?: { path: string }
}): JSX.Element {
  const close = (): void => useAppStore.setState({ dialog: null })
  const [propsBusy, setPropsBusy] = useState(false)
  const [propsError, setPropsError] = useState<string | null>(null)
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
    if (path) {
      await store.applySettingsPatch({
        folderStatsSkipPaths: addFolderStatsSkipPath(store.settings.folderStatsSkipPaths, path)
      })
      const saved = useAppStore.getState().settings.folderStatsSkipPaths
      if (!saved.some((p) => samePath(p, path))) {
        setSkipBusy(false)
        return
      }
      if (samePath(path, retryFolderStats.path)) {
        close()
        store.notify('Folder added to the Calculate Statistics skip list')
        return
      }
    }
    close()
    void store.calculateFolderStatistics(retryFolderStats.path, {
      skipTagged: true,
      ...(skipOnError ? { skipOnError: true } : {})
    })
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
          <button type="button" className="btn primary" onClick={close} autoFocus>
            OK
          </button>
        </>
      }
    >
      <div className="alert-message">{message}</div>
      {detail ? <div className="alert-detail">{detail}</div> : null}
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
  const count = useAppStore((s) => s.recycleBin.items.length)
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
      <p>
        {count === 1
          ? 'Permanently delete the 1 item in the Recycle Bin?'
          : `Permanently delete all ${count} items in the Recycle Bin?`}
      </p>
      <p className="dim">This cannot be undone.</p>
    </Modal>
  )
}

function ConfirmDeleteFromRecycleBin({ paths }: { paths: string[] }): JSX.Element {
  const confirmDeleteFromRecycleBin = useAppStore((s) => s.confirmDeleteFromRecycleBin)
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
        {paths.length === 1
          ? `"${basename(paths[0]!)}" will be permanently removed from the Recycle Bin.`
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
    if (!focused || focused.kind !== 'name_conflict' || !destDir) {
      setCompare(null)
      return
    }
    let cancelled = false
    void call(api.fs.checkConflicts({ sources: [focused.source], destinationDir: destDir }))
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
        : dialog.op === 'trash'
          ? 'Recycle'
          : 'Delete'

  const showCompare = focused?.kind === 'name_conflict'
  const incoming = compare?.source ?? (focused ? sideFromPath(focused.source, focused.sourceMtimeMs) : null)
  const existing =
    compare?.destination ??
    (focused?.dest ? sideFromPath(focused.dest, focused.destMtimeMs) : null)

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
        Everything that could proceed already did. Decide what to do with the rest — apply to all
        similar, or expand a group to choose per item.
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
                  {actions.map((a) => (
                    <button
                      key={a.decision}
                      type="button"
                      className={`btn${a.decision === 'replace' || a.decision === 'retry' ? ' primary' : ''}`}
                      title={`Apply “${a.label}” to all ${g.label.toLowerCase()}`}
                      onClick={() => applyItems(g.items, a.decision)}
                    >
                      {a.label} all
                    </button>
                  ))}
                </div>
              </header>
              {open && (
                <ul className="op-issues-rows">
                  {g.items.map((it) => {
                    const key = issueKey(it)
                    const active = key === focusKey
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={`op-issues-row${active ? ' active' : ''}`}
                          onClick={() => setFocusKey(key)}
                        >
                          <span className="op-issues-row-name" title={it.source}>
                            {basename(it.source)}
                          </span>
                          <span className="op-issues-row-msg" title={it.message}>
                            {it.message}
                          </span>
                        </button>
                        <div className="op-issues-row-actions">
                          {actions.map((a) => (
                            <button
                              key={a.decision}
                              type="button"
                              className="btn"
                              onClick={() => applyItems([it], a.decision)}
                            >
                              {a.label}
                            </button>
                          ))}
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

      {showCompare && incoming && existing && (
        <div className="conflict-compare">
          <ConflictSideCard label="Incoming" side={incoming} peer={existing} />
          <div className="conflict-vs" aria-hidden>
            vs
          </div>
          <ConflictSideCard label="Existing in destination" side={existing} peer={incoming} />
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

function PropertiesDialog({ path }: { path: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const refresh = useAppStore((s) => s.refresh)
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

  const attrsEditable = model != null && model.kind !== 'drive' && model.kind !== 'missing'
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
      actions={
        <>
          {model && model.kind !== 'missing' && (
            <div className="modal-action-start props-sys-actions">
              <button
                type="button"
                className="btn"
                disabled={sysPropsBusy}
                title="Open the Windows Explorer Properties window (Security, Sharing, …)"
                onClick={() => void openWindowsProperties()}
              >
                Windows Properties…
              </button>
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
            </tbody>
          </table>

          {model.drive && (
            <div className="props-drive">
              <div className="form-section">Capacity</div>
              <table className="props-table">
                <tbody>
                  {model.drive.fileSystem && (
                    <tr>
                      <td>File system</td>
                      <td>
                        <PropsValue value={model.drive.fileSystem} />
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td>Used space</td>
                    <td>
                      <PropsValue
                        value={`${formatBytes(model.drive.usedBytes)} (${model.drive.usedBytes.toLocaleString()} bytes) — ${percent(model.drive.usedBytes, model.drive.capacityBytes).toFixed(1)}%`}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Free space</td>
                    <td>
                      <PropsValue
                        value={`${formatBytes(model.drive.freeBytes)} (${model.drive.freeBytes.toLocaleString()} bytes) — ${percent(model.drive.freeBytes, model.drive.capacityBytes).toFixed(1)}%`}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td>Capacity</td>
                    <td>
                      <PropsValue
                        value={`${formatBytes(model.drive.capacityBytes)} (${model.drive.capacityBytes.toLocaleString()} bytes)`}
                      />
                    </td>
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

type SettingsSection =
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
  | 'advanced'
  | 'about'

const SETTINGS_NAV: { id: SettingsSection; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'contextmenu', label: 'Context menu' },
  { id: 'quickaccess', label: 'Quick access' },
  { id: 'layouts', label: 'Layouts' },
  { id: 'folderviews', label: 'Folder views' },
  { id: 'filter', label: 'View filter' },
  { id: 'preview', label: 'Preview' },
  { id: 'search', label: 'Search index' },
  { id: 'network', label: 'Network' },
  { id: 'remoterepos', label: 'Remote repositories' },
  { id: 'slideshow', label: 'Slideshow' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'about', label: 'About' }
]

function SettingsToggle({
  id,
  label,
  hint,
  hintAsTooltip = false,
  className,
  checked,
  onChange
}: {
  id: string
  label: string
  hint?: string
  hintAsTooltip?: boolean
  className?: string
  checked: boolean
  onChange(v: boolean): void
}): JSX.Element {
  return (
    <label
      className={className ?? 'settings-toggle'}
      htmlFor={id}
      title={hintAsTooltip ? hint : undefined}
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
  const removeFolderCustomization = useAppStore((s) => s.removeFolderCustomization)
  const setFolderViewRecursive = useAppStore((s) => s.setFolderViewRecursive)
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

  const startSection = SETTINGS_NAV.some((s) => s.id === initialSection)
    ? (initialSection as SettingsSection)
    : 'appearance'
  const [section, setSection] = useState<SettingsSection>(startSection)
  const [localComputerName, setLocalComputerName] = useState('')
  const devGateActive = useAppStore((s) => s.devGateActive)
  const navItems = SETTINGS_NAV
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
  const qaEntries = useMemo(() => {
    const tokens = materializeQuickAccessTokens(
      quickAccessSetting,
      quickAccessPins,
      quickAccessHiddenDefaults
    )
    return buildQuickAccess(knownFolders, tokens)
  }, [knownFolders, quickAccessSetting, quickAccessPins, quickAccessHiddenDefaults])

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
        <nav className="settings-nav" aria-label="Settings sections">
          {navItems.map((item) => (
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
        <div className="settings-pane">
          <h2 className="settings-pane-title">{sectionTitle}</h2>

          {section === 'appearance' && (
            <div className="settings-grid">
              <label className="settings-field" htmlFor="set-theme">
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
              <label className="settings-field" htmlFor="set-font">
                <span>Font family</span>
                <input
                  id="set-font"
                  type="text"
                  value={settings.fontFamily}
                  onChange={(e) => void applySettingsPatch({ fontFamily: e.target.value })}
                />
              </label>
              <label className="settings-field settings-field-narrow" htmlFor="set-fontsize">
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
              <label className="settings-field settings-field-narrow" htmlFor="set-iconsize">
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
              {settings.theme === 'custom' && (
                <div className="settings-theme-tokens">
                  {THEME_TOKENS.map(({ key, label }) => (
                    <label className="settings-token" key={key} htmlFor={`theme-${key}`}>
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
              <label className="settings-field" htmlFor="set-net-mode">
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
                <label className="settings-field settings-field-narrow" htmlFor="set-net-interval">
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
                  disabled={
                    settings.networkDiscovery.enabled === false || networkStatus === 'running'
                  }
                  onClick={() => void startNetworkDiscovery()}
                >
                  {networkStatus === 'running' ? 'Discovering…' : 'Discover now'}
                </button>
                <button type="button" className="btn" onClick={() => void openMapNetworkDrive()}>
                  Map network drive…
                </button>
                <button
                  type="button"
                  className="btn"
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
                <span>Invalid images folder</span>
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
                <span>Compiled file lists folder</span>
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
                <span>Categorizer map</span>
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

          {section === 'behavior' && (
            <div className="settings-stack">
              <label className="settings-field" htmlFor="set-newtab">
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
              <label className="settings-field settings-field-narrow" htmlFor="set-vidthumbms">
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
                onChange={(v) => void applySettingsPatch({ confirmPermanentDeleteAlways: v })}
              />
              <label className="settings-field" htmlFor="set-hide-exts">
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
              <div className="settings-field settings-field-separator">
                <span>Calculate Statistics skip list</span>
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

          {section === 'quickaccess' && (
            <div className="settings-stack">
              <div className="settings-index-head">
                <p className="settings-help">
                  Shortcuts in the folder tree. You can also pin/unpin from the context menu or drop
                  a folder on the Quick access header.
                </p>
                <div className="settings-inline">
                  <button type="button" className="btn" onClick={() => void addQuickAccessFolder()}>
                    Add folder…
                  </button>
                  <button type="button" className="btn" onClick={() => void resetQuickAccess()}>
                    Reset defaults
                  </button>
                </div>
              </div>
              {qaEntries.length === 0 ? (
                <p className="settings-help">No Quick access items. Add a folder or reset defaults.</p>
              ) : (
                <div className="settings-qa-list">
                  {qaEntries.map((entry, index) => (
                    <div className="settings-qa-row" key={entry.token}>
                      <div className="settings-qa-meta">
                        <span className="settings-qa-label">{entry.label}</span>
                        <span className="settings-qa-path" title={entry.path}>
                          {entry.path}
                        </span>
                      </div>
                      <div className="settings-qa-actions">
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
                          disabled={index >= qaEntries.length - 1}
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
                  ))}
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
                expand, scoped roots — plus tree/preview widths, multi-pane mode (1 / 2 / 4), which
                tab sits in each pane, and the 2- and 4-pane splitter positions. Applying a layout
                replaces the current tabs. Per-folder Details customizations (Folder views) stay
                separate.
              </p>
              <div className="settings-qa-actions" style={{ justifyContent: 'flex-start' }}>
                <button
                  type="button"
                  className="btn primary"
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
                checked={settings.viewFilterEnabled}
                onChange={(v) => void applySettingsPatch({ viewFilterEnabled: v })}
              />
              <textarea
                className="filter-textarea"
                aria-label="View filter patterns"
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
              <label className="settings-field settings-field-narrow" htmlFor="set-maxbytes">
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
                  <button type="button" className="btn" onClick={() => void addRoot()}>
                    Add folder…
                  </button>
                  <button type="button" className="btn" onClick={() => void addDrive()}>
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
                        onClick={() => void reindexAction(root.path)}
                      >
                        Reindex
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void removeIndexRootAction(root.path)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
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
                  <label className="settings-field" htmlFor="set-filter-name">
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
                  <label className="settings-field" htmlFor="set-filter-query">
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
                  <label className="settings-field" htmlFor="set-filter-macro">
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
                  <label className="settings-field" htmlFor="set-bookmark-name">
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
                  <label className="settings-field" htmlFor="set-bookmark-query">
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
              />

              <div className="form-section">Search HTTP API</div>
              <SettingsToggle
                id="set-search-http"
                label="Enable localhost search API"
                hint="GET http://127.0.0.1:<port>/search?q=…&token=… — indexed roots only. Bind loopback only."
                checked={settings.searchHttpEnabled}
                onChange={(v) => void applySettingsPatch({ searchHttpEnabled: v })}
              />
              <label className="settings-field settings-field-narrow" htmlFor="set-search-http-port">
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
              <label className="settings-field" htmlFor="set-search-http-token">
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
                  <div className="settings-toggle-label">App data</div>
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
                  <div className="settings-toggle-label">Icon & thumbnail cache</div>
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
                  <div className="settings-toggle-label">Help & documentation</div>
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
                  <div className="settings-toggle-label">Updates</div>
                  <div className="settings-toggle-hint">
                    Current version: {appVersion || '…'}. Leave empty (or use the default GitHub
                    Releases URL), or point at a local folder of installers named like{' '}
                    <code>MyFileExplorer Setup 0.x.y.exe</code> or{' '}
                    <code>MyFileExplorer-0.x.y.exe</code>. Check finds the newest build; Update
                    downloads (if URL) and runs it.
                  </div>
                  <label className="settings-field" htmlFor="set-updates-folder">
                    <span>Updates source</span>
                    <div className="settings-inline">
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
                    </div>
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
                <div>
                  <div className="settings-toggle-label">Export / import settings</div>
                  <div className="settings-toggle-hint">
                    Save a portable JSON backup of all preferences — including context menu
                    customization (built-in show/hide and order, Discover scan catalog and enabled
                    verbs, Custom files/folders commands), theme, named layouts, folder views,
                    slideshow, network discovery, remembered Network hosts, remote repository
                    connections without passwords, and everything else in Settings. Dialog and
                    main-window positions are not included. Import replaces current settings; open
                    tabs are unchanged (apply a named layout to restore a workspace). Re-enter
                    remote passwords after import.
                  </div>
                </div>
                <div className="settings-btn-stack">
                  <button type="button" className="btn" onClick={() => void exportSettingsFile()}>
                    Export…
                  </button>
                  <button type="button" className="btn" onClick={() => void importSettingsFile()}>
                    Import…
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
