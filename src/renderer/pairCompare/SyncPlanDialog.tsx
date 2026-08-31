import { useEffect, useMemo, useState, type JSX } from 'react'
import type { PairSyncAction, PairSyncPlanEntry, PairSyncPolicy } from '@shared/pairCompare/types'
import { api, call } from '../lib/ipc'
import { useAppStore } from '../store/appStore'
import { usePairCompareStore } from './pairCompareStore'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

const FILTERS = ['all', 'copy', 'replace', 'delete', 'conflicts', 'excluded'] as const

export function SyncPlanDialog(): JSX.Element | null {
  const plan = usePairCompareStore((s) => s.syncPlan)
  const clearSyncPlan = usePairCompareStore((s) => s.clearSyncPlan)
  const startCompare = usePairCompareStore((s) => s.startCompare)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const notify = useAppStore((s) => s.notify)

  const [policy, setPolicy] = useState<PairSyncPolicy>('update')
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [decisions, setDecisions] = useState<
    Map<string, 'use_left' | 'use_right' | 'keep_both' | 'keep_recent' | 'skip'>
  >(new Map())
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [mirrorAck, setMirrorAck] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!plan) return
    setPolicy(plan.policy)
    setChecked(new Set(plan.entries.filter((e) => e.action !== 'conflict').map((e) => e.id)))
    setMirrorAck(false)
  }, [plan])

  const filtered = useMemo(() => {
    if (!plan) return []
    return plan.entries.filter((e) => {
      if (filter === 'all') return true
      if (filter === 'copy') return e.action === 'copy' || e.action === 'create_folder'
      if (filter === 'replace') return e.action === 'replace'
      if (filter === 'delete') return e.action === 'trash' || e.action === 'delete_permanent'
      if (filter === 'conflicts') return e.action === 'conflict'
      return e.action === 'skip'
    })
  }, [plan, filter])

  if (!plan) return null

  const dirLabel =
    plan.direction === 'left_to_right'
      ? 'left → right'
      : plan.direction === 'right_to_left'
        ? 'right → left'
        : 'two-way'

  const unresolved = plan.entries.some(
    (e) => e.requiredDecision && e.action === 'conflict' && !decisions.has(e.id) && checked.has(e.id)
  )
  const canRun =
    !busy && !unresolved && (policy !== 'mirror' || mirrorAck) && checked.size > 0

  const rebuildWithPolicy = async (next: PairSyncPolicy): Promise<void> => {
    setPolicy(next)
    const s = usePairCompareStore.getState()
    if (!s.sessionId) return
    try {
      const rebuilt = await call(
        api.pairCompare.buildPlan({
          sessionId: s.sessionId,
          direction: plan.direction,
          policy: next,
          scope: plan.scope,
          selectedRowIds: [...s.selectedRowIds],
          visibleStatuses: [...s.visibleStatuses]
        })
      )
      usePairCompareStore.setState({ syncPlan: rebuilt })
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Rebuild failed', true)
    }
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const validation = await call(api.pairCompare.revalidatePlan({ planId: plan.planId }))
      if (!validation.ok) {
        notify(
          `Plan is stale (${validation.staleEntryIds.length} changed). Recompare and build again.`,
          true
        )
        setBusy(false)
        return
      }
      const res = await call(
        api.pairCompare.executePlan({
          planId: plan.planId,
          approvedEntryIds: [...checked],
          decisions: [...decisions.entries()].map(([entryId, decision]) => ({
            entryId,
            decision
          })),
          mirrorAck: policy === 'mirror' ? mirrorAck : undefined
        })
      )
      notify(
        `Sync done — copied ${res.copied}, replaced ${res.replaced}, removed ${res.removed}, failed ${res.failed}`
      )
      clearSyncPlan()
      closeDialog()
      usePairCompareStore.getState().markStale()
      void startCompare()
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Sync failed', true)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (e: PairSyncPlanEntry): void => {
    const next = new Set(checked)
    if (next.has(e.id)) next.delete(e.id)
    else next.add(e.id)
    setChecked(next)
  }

  const actionLabel = (a: PairSyncAction): string => {
    switch (a) {
      case 'create_folder':
        return 'Create folder'
      case 'delete_permanent':
        return 'Permanent delete'
      default:
        return a.charAt(0).toUpperCase() + a.slice(1)
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal pair-sync-dialog" role="dialog" aria-labelledby="pair-sync-title">
        <header className="pair-sync-header">
          <h2 id="pair-sync-title">Synchronize {dirLabel}</h2>
          <p className="pair-sync-roots">
            {plan.leftRoot} <span aria-hidden>→</span> {plan.rightRoot}
          </p>
          <p className="pair-sync-meta">
            Policy:{' '}
            <select
              value={policy}
              onChange={(e) => void rebuildWithPolicy(e.target.value as PairSyncPolicy)}
              disabled={plan.direction === 'two_way'}
            >
              <option value="update">Update destination</option>
              <option value="missing_only">Copy missing only</option>
              <option value="mirror" disabled={plan.incompleteSource}>
                Mirror source (removes destination-only)
              </option>
            </select>
            {plan.incompleteSource ? ' · Mirror disabled (incomplete scan)' : ''}
          </p>
        </header>

        <div className="pair-sync-summary">
          <div className="pair-sync-card">Copy {plan.summary.copy}</div>
          <div className="pair-sync-card">Replace {plan.summary.replace}</div>
          <div className="pair-sync-card">Folders {plan.summary.createFolder}</div>
          <div className={`pair-sync-card${plan.summary.remove ? ' danger' : ''}`}>
            Remove {plan.summary.remove}
          </div>
          <div className="pair-sync-card">Conflicts {plan.summary.conflicts}</div>
          <div className="pair-sync-card">{formatBytes(plan.summary.bytes)}</div>
        </div>

        <div className="pair-sync-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`btn ghost${filter === f ? ' is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="pair-sync-table-wrap">
          <table className="pair-sync-table">
            <thead>
              <tr>
                <th />
                <th>Action</th>
                <th>Relative path</th>
                <th>Reason</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={checked.has(e.id)}
                      onChange={() => toggle(e)}
                    />
                  </td>
                  <td>{actionLabel(e.action)}</td>
                  <td title={e.relativePath}>{e.relativePath}</td>
                  <td>{e.reason}</td>
                  <td>
                    {e.action === 'conflict' ? (
                      <select
                        value={decisions.get(e.id) ?? ''}
                        onChange={(ev) => {
                          const v = ev.target.value as
                            | 'use_left'
                            | 'use_right'
                            | 'keep_both'
                            | 'keep_recent'
                            | 'skip'
                            | ''
                          const next = new Map(decisions)
                          if (!v) next.delete(e.id)
                          else next.set(e.id, v)
                          setDecisions(next)
                          if (v && v !== 'skip') {
                            const c = new Set(checked)
                            c.add(e.id)
                            setChecked(c)
                          }
                        }}
                      >
                        <option value="">Choose…</option>
                        <option value="use_left">Use left</option>
                        <option value="use_right">Use right</option>
                        <option value="keep_both">Keep both</option>
                        <option value="keep_recent">Keep most recent</option>
                        <option value="skip">Skip</option>
                      </select>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {policy === 'mirror' ? (
          <label className="pair-sync-ack">
            <input
              type="checkbox"
              checked={mirrorAck}
              onChange={(e) => setMirrorAck(e.target.checked)}
            />
            I understand that destination-only items listed above will be removed.
          </label>
        ) : null}

        <footer className="pair-sync-footer">
          <button
            type="button"
            className="btn"
            onClick={() => {
              clearSyncPlan()
              closeDialog()
            }}
          >
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!canRun} onClick={() => void run()}>
            {busy ? 'Running…' : 'Run synchronization'}
          </button>
        </footer>
      </div>
    </div>
  )
}
