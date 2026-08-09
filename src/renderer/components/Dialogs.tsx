import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import type { ConflictDecision, ConflictItem, ConflictSide } from '@shared/schemas/fs'
import type { CustomTheme } from '@shared/schemas/settings'
import type { FolderMeasureResult, PropertiesModel } from '@shared/schemas/properties'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { formatBytes, formatDate } from '../lib/format'
import { folderViewSummary } from '@shared/folderViews'
import { formatLayoutUpdatedAt, layoutSummary } from '@shared/layouts'
import { VID_THUMB_FRAME_MS_MAX, VID_THUMB_FRAME_MS_MIN } from '@shared/vidThumbCache'
import { buildQuickAccess, materializeQuickAccessTokens } from '../lib/quickAccess'
import { basename } from '../lib/paths'
import { iconForEntry, isImageExt } from '../lib/icons'
import { ThumbImage } from './ThumbImage'
import { ShellIcon } from './ShellIcon'
import { TabIconPickerDialog } from './TabIconPickerDialog'

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
        <div className="modal-title">{title}</div>
        <div className={bodyClass}>{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

export function Dialogs(): JSX.Element | null {
  const dialog = useAppStore((s) => s.dialog)
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
    case 'new-file':
      return <NewFileDialog parent={dialog.parent} />
    case 'properties':
      return <PropertiesDialog path={dialog.path} />
    case 'settings':
      return <SettingsDialog initialSection={dialog.section} />
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
        <AlertDialog title={dialog.title} message={dialog.message} detail={dialog.detail} />
      )
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
  detail
}: {
  title: string
  message: string
  detail?: string
}): JSX.Element {
  const close = (): void => useAppStore.setState({ dialog: null })
  return (
    <Modal
      title={title}
      onClose={close}
      actions={
        <button className="btn primary" onClick={close} autoFocus>
          OK
        </button>
      }
    >
      <div className="alert-message">{message}</div>
      {detail ? <div className="alert-detail">{detail}</div> : null}
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
  const Icon = iconForEntry(side.ext, isDir)
  const newer = side.mtimeMs > 0 && side.mtimeMs > peer.mtimeMs
  const larger = !isDir && side.size > 0 && side.size > peer.size
  const dims =
    side.width && side.height ? `${side.width} × ${side.height}` : null

  return (
    <div className="conflict-side">
      <div className="conflict-side-label">{label}</div>
      <div className={`conflict-preview${showImage ? ' is-image' : ''}`}>
        {showImage ? (
          <ThumbImage
            path={side.path}
            mtimeMs={side.mtimeMs}
            size={280}
            fallback={<Icon size={48} />}
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

  useEffect(() => {
    setIndex(0)
    setDecisions({})
    setApplyToRest(false)
  }, [dialog?.kind === 'conflict' ? dialog.destinationDir : null])

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
  | 'quickaccess'
  | 'layouts'
  | 'folderviews'
  | 'filter'
  | 'preview'
  | 'search'
  | 'advanced'

const SETTINGS_NAV: { id: SettingsSection; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'quickaccess', label: 'Quick access' },
  { id: 'layouts', label: 'Layouts' },
  { id: 'folderviews', label: 'Folder views' },
  { id: 'filter', label: 'View filter' },
  { id: 'preview', label: 'Preview' },
  { id: 'search', label: 'Search index' },
  { id: 'advanced', label: 'Advanced' }
]

function SettingsToggle({
  id,
  label,
  hint,
  checked,
  onChange
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  onChange(v: boolean): void
}): JSX.Element {
  return (
    <label className="settings-toggle" htmlFor={id}>
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {hint && <span className="settings-toggle-hint">{hint}</span>}
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

function SettingsDialog({ initialSection }: { initialSection?: string }): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const notify = useAppStore((s) => s.notify)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const clearThumbCache = useAppStore((s) => s.clearThumbCache)
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
  const folderViews = useAppStore((s) => s.settings.folderViews)
  const layouts = useAppStore((s) => s.settings.layouts)

  const startSection = SETTINGS_NAV.some((s) => s.id === initialSection)
    ? (initialSection as SettingsSection)
    : 'appearance'
  const [section, setSection] = useState<SettingsSection>(startSection)
  const [filterText, setFilterText] = useState(settings.viewFilterPatterns.join('\n'))
  const [excludeDraft, setExcludeDraft] = useState('')
  const [hideExtText, setHideExtText] = useState(settings.hideNameExtensions.join('\n'))
  const [appVersion, setAppVersion] = useState('')
  const [userDataPath, setUserDataPath] = useState('')
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [updateCandidate, setUpdateCandidate] = useState<{
    path: string
    fileName: string
    version: string | null
    newer: boolean
  } | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)

  useEffect(() => {
    void call(api.app.getVersion())
      .then((r) => setAppVersion(r.version))
      .catch(() => setAppVersion(''))
    void call(api.app.getPath({ name: 'userData' }))
      .then((r) => setUserDataPath(r.path))
      .catch(() => setUserDataPath(''))
  }, [])
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

  const sectionTitle = SETTINGS_NAV.find((s) => s.id === section)?.label ?? 'Settings'
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
          Done
        </button>
      }
    >
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_NAV.map((item) => (
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
                  <input
                    id="set-fontsize"
                    type="number"
                    min={9}
                    max={28}
                    value={settings.fontSizePx}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (v >= 9 && v <= 28) void applySettingsPatch({ fontSizePx: v })
                    }}
                  />
                  <span className="dim">px</span>
                </div>
              </label>
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
            </div>
          )}

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
                expand, scoped roots — plus tree/preview pane sizes. Applying a layout replaces the
                current tabs. Per-folder Details customizations (Folder views) stay separate.
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
                            title="Overwrite this layout with the current tabs and panes"
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
              <div className="form-section">Exclude folder names</div>
              <div className="settings-index-head">
                <p className="settings-help">
                  Blacklist: folder names skipped while indexing (e.g. <code>node_modules</code>,{' '}
                  <code>.git</code>). Case-insensitive match on the directory name only.
                </p>
                <div className="settings-inline">
                  <input
                    id="set-exclude-add"
                    type="text"
                    className="settings-exclude-input"
                    placeholder="Folder name"
                    value={excludeDraft}
                    spellCheck={false}
                    onChange={(e) => setExcludeDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      const name = excludeDraft.trim()
                      if (!name) return
                      const key = name.toLowerCase()
                      if (settings.searchExcludeDirNames.some((n) => n.toLowerCase() === key)) {
                        setExcludeDraft('')
                        return
                      }
                      void applySettingsPatch({
                        searchExcludeDirNames: [...settings.searchExcludeDirNames, name]
                      })
                      setExcludeDraft('')
                    }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const name = excludeDraft.trim()
                      if (!name) return
                      const key = name.toLowerCase()
                      if (settings.searchExcludeDirNames.some((n) => n.toLowerCase() === key)) {
                        setExcludeDraft('')
                        return
                      }
                      void applySettingsPatch({
                        searchExcludeDirNames: [...settings.searchExcludeDirNames, name]
                      })
                      setExcludeDraft('')
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="settings-index-list exclude">
                {settings.searchExcludeDirNames.length === 0 ? (
                  <div className="settings-help">No excluded names — all folders are crawled.</div>
                ) : (
                  settings.searchExcludeDirNames.map((name) => (
                    <div className="index-root-row" key={name.toLowerCase()}>
                      <span className="root-path" title={name}>
                        {name}
                      </span>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          void applySettingsPatch({
                            searchExcludeDirNames: settings.searchExcludeDirNames.filter(
                              (n) => n.toLowerCase() !== name.toLowerCase()
                            )
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>

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
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const name = window.prompt('Filter name')
                  if (!name?.trim()) return
                  const query = window.prompt('Query (e.g. ext:jpg;png or pic:)')
                  if (query == null) return
                  const macro = window.prompt('Macro alias (optional, without colon)') ?? ''
                  void applySettingsPatch({
                    searchFilters: [
                      ...settings.searchFilters,
                      {
                        id: `flt_${Date.now().toString(36)}`,
                        name: name.trim(),
                        query: query.trim(),
                        ...(macro.trim() ? { macro: macro.trim() } : {})
                      }
                    ]
                  })
                }}
              >
                Add filter…
              </button>

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
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const name = window.prompt('Bookmark name')
                  if (!name?.trim()) return
                  const query = window.prompt('Query')
                  if (query == null || !query.trim()) return
                  void applySettingsPatch({
                    searchBookmarks: [
                      ...settings.searchBookmarks,
                      {
                        id: `bm_${Date.now().toString(36)}`,
                        name: name.trim(),
                        query: query.trim(),
                        scope: 'indexed'
                      }
                    ]
                  })
                }}
              >
                Add bookmark…
              </button>
            </div>
          )}

          {section === 'advanced' && (
            <div className="settings-stack">
              <div className="settings-action-card">
                <div>
                  <div className="settings-toggle-label">Updates</div>
                  <div className="settings-toggle-hint">
                    Current version: {appVersion || '…'}. Point at a folder that contains
                    installers named like <code>MyFileExplorer Setup 0.x.y.exe</code>, then check
                    and run the newest one.
                  </div>
                </div>
              </div>
              <label className="settings-field" htmlFor="set-updates-folder">
                <span>Updates folder</span>
                <div className="settings-inline">
                  <input
                    id="set-updates-folder"
                    type="text"
                    spellCheck={false}
                    value={settings.updatesFolder}
                    placeholder="e.g. D:\Builds\MyFileExplorer"
                    onChange={(e) => void applySettingsPatch({ updatesFolder: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn"
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
              <div className="settings-inline">
                <button
                  type="button"
                  className="btn"
                  disabled={!settings.updatesFolder.trim() || updateBusy}
                  onClick={() => {
                    void (async () => {
                      setUpdateBusy(true)
                      setUpdateStatus(null)
                      setUpdateCandidate(null)
                      try {
                        const res = await call(
                          api.app.checkUpdate({ folder: settings.updatesFolder })
                        )
                        if (!res.candidate) {
                          setUpdateStatus('No MyFileExplorer installer found in that folder.')
                        } else {
                          setUpdateCandidate(res.candidate)
                          if (res.candidate.newer) {
                            setUpdateStatus(
                              res.candidate.version
                                ? `Found ${res.candidate.fileName} (v${res.candidate.version}) — newer than ${res.candidate.currentVersion}.`
                                : `Found ${res.candidate.fileName}.`
                            )
                          } else {
                            setUpdateStatus(
                              res.candidate.version
                                ? `Found ${res.candidate.fileName} (v${res.candidate.version}) — same or older than installed ${res.candidate.currentVersion}.`
                                : `Found ${res.candidate.fileName}.`
                            )
                          }
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
                <button
                  type="button"
                  className="btn"
                  disabled={!updateCandidate || updateBusy}
                  onClick={() => {
                    if (!updateCandidate) return
                    void (async () => {
                      setUpdateBusy(true)
                      try {
                        await call(
                          api.app.runUpdate({
                            path: updateCandidate.path,
                            folder: settings.updatesFolder
                          })
                        )
                        setUpdateStatus('Launching installer… the app will close.')
                      } catch (e) {
                        setUpdateStatus(e instanceof Error ? e.message : String(e))
                        setUpdateBusy(false)
                      }
                    })()
                  }}
                >
                  {updateCandidate?.newer ? 'Install update' : 'Run installer'}
                </button>
              </div>
              {updateStatus && <p className="settings-help">{updateStatus}</p>}

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
        </div>
      </div>
    </Modal>
  )
}
