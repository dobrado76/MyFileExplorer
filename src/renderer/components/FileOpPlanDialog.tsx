import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type {
  ConflictPolicy,
  FileOpPlanRequest,
  FileOpPlanResponse,
  FileOpPlanRow
} from '@shared/schemas/fs'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { basename, parentOf } from '../lib/paths'
import { formatBytes } from '../lib/format'
import { CloseIcon } from '../lib/icons'

const CONFLICT_POLICIES: ConflictPolicy[] = ['fail', 'rename', 'skip', 'replace']

const OP_LABEL: Record<FileOpPlanResponse['op'], string> = {
  copy: 'Copy',
  move: 'Move',
  trash: 'Recycle',
  delete: 'Delete permanently'
}

const ROW_ACTION: Record<FileOpPlanResponse['op'], string> = {
  copy: 'Copy',
  move: 'Move',
  trash: 'Recycle',
  delete: 'Delete'
}

const CONFLICT_POLICY_LABEL: Record<ConflictPolicy, string> = {
  fail: 'Ask on name conflict',
  replace: 'Replace existing',
  skip: 'Skip conflicting items',
  rename: 'Keep both (auto-rename)'
}

const OPTION_TIPS = {
  verify:
    'Re-read the destination and compare SHA-256 against the hash computed while copying. This can significantly increase operation time.',
  preserveTimestamps: 'Copy Created, Modified, and NTFS Change times from the source.',
  preserveAds:
    'Keep ADS (notes, icons, metadata, version history) when the volume supports them.',
  permanent: 'Skip the Recycle Bin and remove files immediately (cannot be undone).',
  continueOnRecoverable:
    'Keep going when the destination is full or missing instead of stopping the batch.'
} as const

const DRY_RUN_TIP =
  'Show a preview of every operation that would run — nothing is written or deleted. Review the list, then click the action button to execute with the same settings.'

function rowStatusLabel(row: FileOpPlanRow, policy: ConflictPolicy): string {
  if (row.status === 'skip') return 'Skip'
  if (row.status === 'conflict') return policy === 'fail' ? 'Ask' : 'Name clash'
  if (row.dest && basename(row.source).toLowerCase() !== basename(row.dest).toLowerCase()) {
    return 'Keep both'
  }
  if (policy === 'replace' && row.dest) return 'Replace'
  return 'Ready'
}

function operationHeadline(plan: FileOpPlanResponse, permanent: boolean): string {
  const { totals, op } = plan
  const verb =
    op === 'trash' ? (permanent ? 'Delete permanently' : 'Recycle') : OP_LABEL[op]
  const parts = [`${totals.files.toLocaleString()} file${totals.files === 1 ? '' : 's'}`]
  if (totals.bytes > 0) parts.push(formatBytes(totals.bytes))
  if (op === 'trash' || op === 'delete') {
    return `${verb} ${totals.topLevel.toLocaleString()} item${totals.topLevel === 1 ? '' : 's'} · ${parts.join(' · ')}`
  }
  return `${verb} ${parts.join(' · ')}`
}

function buildChoice(
  plan: FileOpPlanResponse,
  opts: {
    verify: boolean
    preserveTimestamps: boolean
    preserveAds: boolean
    continueOnRecoverable: boolean
    permanent: boolean
    conflictPolicy: ConflictPolicy
  }
): {
  proceed: true
  verify?: boolean
  preserveTimestamps?: boolean
  preserveAds?: boolean
  continueOnRecoverable?: boolean
  conflictPolicy?: ConflictPolicy
  permanent?: boolean
} {
  const isCopy = plan.op === 'copy'
  const isMove = plan.op === 'move'
  const isDelete = plan.op === 'trash' || plan.op === 'delete'
  const showTransferOpts = isCopy || (isMove && plan.capabilities.crossVolumeMove)
  return {
    proceed: true,
    verify: isCopy ? opts.verify : undefined,
    preserveTimestamps: showTransferOpts ? opts.preserveTimestamps : undefined,
    preserveAds: showTransferOpts && plan.capabilities.ntfsAdsRelevant ? opts.preserveAds : undefined,
    continueOnRecoverable: plan.capabilities.continueOnRecoverable
      ? opts.continueOnRecoverable
      : undefined,
    conflictPolicy: isCopy || isMove ? opts.conflictPolicy : undefined,
    permanent: isDelete ? opts.permanent : undefined
  }
}

export function FileOpPlanDialog({
  plan: initialPlan,
  request
}: {
  plan: FileOpPlanResponse
  request: FileOpPlanRequest
}): JSX.Element {
  const resolveFileOpPlan = useAppStore((s) => s.resolveFileOpPlan)
  const [plan, setPlan] = useState(initialPlan)
  const [conflictPolicy, setConflictPolicy] = useState(initialPlan.conflictPolicy)
  const [replanning, setReplanning] = useState(false)
  const cap = plan.capabilities
  const isCopy = plan.op === 'copy'
  const isMove = plan.op === 'move'
  const isDelete = plan.op === 'trash' || plan.op === 'delete'
  const showTransferOpts = isCopy || (isMove && cap.crossVolumeMove)

  const [previewShown, setPreviewShown] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(!previewShown)
  const [verify, setVerify] = useState(false)
  const [preserveTimestamps, setPreserveTimestamps] = useState(true)
  const [preserveAds, setPreserveAds] = useState(initialPlan.capabilities.ntfsAdsRelevant)
  const [continueOnRecoverable, setContinueOnRecoverable] = useState(false)
  const [permanent, setPermanent] = useState(initialPlan.deletePermanent ?? false)

  const onConflictPolicyChange = useCallback(
    async (next: ConflictPolicy): Promise<void> => {
      if (request.op !== 'copy' && request.op !== 'move') return
      setConflictPolicy(next)
      setReplanning(true)
      try {
        const nextPlan = await call(api.fs.planOp({ ...request, conflictPolicy: next }))
        setPlan(nextPlan)
        setConflictPolicy(nextPlan.conflictPolicy)
      } finally {
        setReplanning(false)
      }
    },
    [request]
  )

  const runForReal = (): void => {
    resolveFileOpPlan(
      buildChoice(plan, {
        verify,
        preserveTimestamps,
        preserveAds,
        continueOnRecoverable,
        permanent,
        conflictPolicy
      })
    )
  }

  const resultsRef = useRef<HTMLDivElement>(null)
  const opLabel = OP_LABEL[plan.op]
  const confirmLabel = isDelete ? (permanent ? 'Delete' : 'Recycle') : ROW_ACTION[plan.op]
  const rowAction = confirmLabel
  const dest = plan.destinationDir
  const sourceSummary = plan.sourceSummary

  const showDryRunPreview = (): void => {
    setPreviewShown(true)
    setOptionsOpen(false)
  }

  useEffect(() => {
    if (previewShown) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [previewShown])

  const readyRows = plan.rows.filter((r) => r.status === 'ok').length

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && resolveFileOpPlan(null)}
    >
      <div
        className={`modal modal-wide modal-file-op-plan${previewShown ? ' is-dry-run-preview' : ''}`}
        role="dialog"
        aria-label={`${opLabel} plan`}
      >
        <div className="modal-title modal-title-chrome">
          <span className="modal-title-text">
            {previewShown ? 'Dry run preview' : 'Review operation'}
          </span>
          <button
            type="button"
            className="modal-title-btn"
            aria-label="Close"
            onClick={() => resolveFileOpPlan(null)}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="modal-body file-op-plan-body">
          <p className="file-op-plan-headline">{operationHeadline(plan, permanent)}</p>

          {sourceSummary && dest ? (
            <div className="file-op-plan-route">
              <div className="file-op-plan-route-col">
                <span className="file-op-plan-route-label">Source</span>
                <code title={sourceSummary}>{sourceSummary}</code>
              </div>
              <span className="file-op-plan-route-arrow" aria-hidden>
                →
              </span>
              <div className="file-op-plan-route-col">
                <span className="file-op-plan-route-label">Destination</span>
                <code title={dest}>{dest}</code>
              </div>
            </div>
          ) : null}

          {(isCopy || isMove) && (
            <label className="file-op-plan-field">
              <span className="file-op-plan-field-label">Name conflicts</span>
              <select
                className="file-op-plan-select"
                value={conflictPolicy}
                disabled={replanning}
                onChange={(e) => void onConflictPolicyChange(e.target.value as ConflictPolicy)}
              >
                {CONFLICT_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {CONFLICT_POLICY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {previewShown ? (
            <div className="file-op-plan-preview-banner" role="status">
              <strong>Dry run — no changes were made</strong>
              <p>
                {readyRows.toLocaleString()} operation{readyRows === 1 ? '' : 's'} would run with
                the options below. Review the list, then click <strong>{confirmLabel}</strong> to
                execute for real — you will not need to repeat the action.
              </p>
            </div>
          ) : null}

          <section className="file-op-plan-results" ref={resultsRef} aria-label="Operation preview">
            <div className="file-op-plan-results-head">
              <h3 className="file-op-plan-results-title">
                {previewShown ? 'Operations that would run' : 'Planned operations'}
              </h3>
              <span className="file-op-plan-results-meta">
                {plan.rows.length.toLocaleString()} row{plan.rows.length === 1 ? '' : 's'}
                {plan.truncated ? ' (truncated)' : ''}
              </span>
            </div>
            <div className="file-op-plan-table-wrap file-op-plan-table-wrap-main">
              <table className="file-op-plan-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Source</th>
                    {plan.op === 'copy' || plan.op === 'move' ? <th>Destination</th> : null}
                    <th className="num">Files</th>
                    <th className="num">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr key={`${row.source}\0${row.dest ?? ''}`} className={`status-${row.status}`}>
                      <td>
                        <span className="file-op-plan-action">{rowAction}</span>
                      </td>
                      <td>
                      <span className={`file-op-plan-badge status-${row.status}`}>
                        {rowStatusLabel(row, conflictPolicy)}
                      </span>
                      </td>
                      <td title={row.source}>
                        <span className="file-op-plan-name">{basename(row.source)}</span>
                        <span className="file-op-plan-path">{parentOf(row.source) ?? row.source}</span>
                      </td>
                      {plan.op === 'copy' || plan.op === 'move' ? (
                        <td title={row.dest}>
                          {row.dest ? (
                            <>
                              <span className="file-op-plan-name">{basename(row.dest)}</span>
                              <span className="file-op-plan-path">
                                {parentOf(row.dest) ?? row.dest}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      ) : null}
                      <td className="num">{row.fileCount.toLocaleString()}</td>
                      <td className="num">{formatBytes(row.sizeBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {(plan.totals.conflicts > 0 || plan.totals.skips > 0) && (
            <div className="file-op-plan-stats">
              {plan.totals.conflicts > 0 ? (
                <div className="file-op-plan-stat warn">
                  <span className="file-op-plan-stat-val">
                    {plan.totals.conflicts.toLocaleString()}
                  </span>
                  <span className="file-op-plan-stat-label">conflicts</span>
                </div>
              ) : null}
              {plan.totals.skips > 0 ? (
                <div className="file-op-plan-stat dim">
                  <span className="file-op-plan-stat-val">{plan.totals.skips.toLocaleString()}</span>
                  <span className="file-op-plan-stat-label">skipped</span>
                </div>
              ) : null}
            </div>
          )}

          {plan.warnings.length > 0 ? (
            <ul className="file-op-plan-warnings">
              {plan.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <section className="file-op-plan-options" aria-label="Operation options">
            <button
              type="button"
              className="file-op-plan-options-toggle"
              onClick={() => setOptionsOpen((v) => !v)}
              aria-expanded={optionsOpen}
            >
              {optionsOpen ? 'Hide options' : 'Show options'}
            </button>
            {optionsOpen ? (
              <>
                <div className="file-op-plan-options-grid">
                  {isCopy ? (
                    <label className="file-op-plan-option" title={OPTION_TIPS.verify}>
                      <input
                        type="checkbox"
                        checked={verify}
                        onChange={(e) => setVerify(e.target.checked)}
                      />
                      <span className="file-op-plan-option-text">
                        Verify copied data after completion
                      </span>
                    </label>
                  ) : null}

                  {showTransferOpts ? (
                    <label className="file-op-plan-option" title={OPTION_TIPS.preserveTimestamps}>
                      <input
                        type="checkbox"
                        checked={preserveTimestamps}
                        onChange={(e) => setPreserveTimestamps(e.target.checked)}
                      />
                      <span className="file-op-plan-option-text">Preserve timestamps</span>
                    </label>
                  ) : null}

                  {showTransferOpts && cap.ntfsAdsRelevant ? (
                    <label className="file-op-plan-option" title={OPTION_TIPS.preserveAds}>
                      <input
                        type="checkbox"
                        checked={preserveAds}
                        onChange={(e) => setPreserveAds(e.target.checked)}
                      />
                      <span className="file-op-plan-option-text">
                        Preserve NTFS alternate data streams
                      </span>
                    </label>
                  ) : null}

                  {isDelete ? (
                    <label className="file-op-plan-option" title={OPTION_TIPS.permanent}>
                      <input
                        type="checkbox"
                        checked={permanent}
                        onChange={(e) => setPermanent(e.target.checked)}
                      />
                      <span className="file-op-plan-option-text">Delete permanently</span>
                    </label>
                  ) : null}

                  {(isCopy || isMove) && cap.continueOnRecoverable ? (
                    <label
                      className="file-op-plan-option"
                      title={OPTION_TIPS.continueOnRecoverable}
                    >
                      <input
                        type="checkbox"
                        checked={continueOnRecoverable}
                        onChange={(e) => setContinueOnRecoverable(e.target.checked)}
                      />
                      <span className="file-op-plan-option-text">
                        Continue on recoverable errors
                      </span>
                    </label>
                  ) : null}
                </div>

                {isMove && cap.sameVolumeRenameOnly ? (
                  <p className="file-op-plan-note muted">
                    Same-volume move — items are renamed in place; verification and byte-level copy
                    options do not apply.
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
        <div className="modal-actions file-op-plan-actions">
          <button type="button" className="btn" onClick={() => resolveFileOpPlan(null)}>
            Cancel
          </button>
          <div className="file-op-plan-actions-primary">
            {!previewShown ? (
              <button
                type="button"
                className="btn"
                title={DRY_RUN_TIP}
                onClick={showDryRunPreview}
              >
                Dry run
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setOptionsOpen(true)}>
                Edit options
              </button>
            )}
            <button
              type="button"
              className={`btn${isDelete && permanent ? ' danger primary' : ' primary'}`}
              onClick={runForReal}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
