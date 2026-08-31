import { useEffect, useState, type JSX } from 'react'
import type { FolderMeasureResult, PropertiesModel } from '@shared/schemas/properties'
import { api, call } from '../lib/ipc'
import { formatBytes, formatDate } from '../lib/format'
import { UsnManager } from './UsnManager'

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

export type PropertiesPanelProps = {
  path: string
  /** win32 shows drive USN…; default true for this Windows app. */
  platform?: string
  onClose(): void
  /** After attribute change — explorer list refresh when hosted in the shell. */
  onAttributesChanged?(): void
}

/**
 * Properties card body — same chrome/classes as the former in-app dialog
 * (title, table, capacity, footer actions). Host fills the OS window.
 */
export function PropertiesPanel({
  path,
  platform = 'win32',
  onClose,
  onAttributesChanged
}: PropertiesPanelProps): JSX.Element {
  const [model, setModel] = useState<PropertiesModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [measure, setMeasure] = useState<FolderMeasureResult | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [attrBusy, setAttrBusy] = useState(false)
  const [attrError, setAttrError] = useState<string | null>(null)
  const [sysPropsBusy, setSysPropsBusy] = useState(false)
  const [sysPropsError, setSysPropsError] = useState<string | null>(null)
  const [usnOpen, setUsnOpen] = useState(false)

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (usnOpen) setUsnOpen(false)
        else onClose()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, usnOpen])

  useEffect(() => {
    if (!model) return
    const kind =
      model.kind === 'drive' ? 'Drive' : model.kind === 'dir' ? 'Folder' : 'File'
    document.title = `${model.name} — ${kind} Properties`
  }, [model])

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
      onAttributesChanged?.()
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
    <>
      <div className="properties-window-root">
        <div className="modal modal-properties is-window" role="dialog" aria-label={title}>
          <div className="modal-body">
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
                          <td>
                            {percent(model.drive.usedBytes, model.drive.capacityBytes).toFixed(1)}%
                          </td>
                        </tr>
                        <tr>
                          <td>Free space</td>
                          <td>{formatBytes(model.drive.freeBytes)}</td>
                          <td>{model.drive.freeBytes.toLocaleString()} bytes</td>
                          <td>
                            {percent(model.drive.freeBytes, model.drive.capacityBytes).toFixed(1)}%
                          </td>
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
          </div>
          <div className="modal-actions">
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
                      onClick={() => setUsnOpen(true)}
                    >
                      USN…
                    </button>
                  )}
                </div>
                {sysPropsError && <div className="props-attr-error">{sysPropsError}</div>}
              </div>
            )}
            <button type="button" className="btn primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
      {usnOpen && model?.kind === 'drive' && (
        <UsnManager path={model.path} onClose={() => setUsnOpen(false)} />
      )}
    </>
  )
}
