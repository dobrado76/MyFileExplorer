import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { AppError } from '@shared/result'
import { buildSyncPlan } from '@shared/pairCompare/plan'
import { isPathUnder } from '@shared/pairCompare/pathUtils'
import type {
  PairComparisonResult,
  PairSyncPlan,
  PairSyncDirection,
  PairSyncPolicy,
  PairSyncScope,
  PairCompareStatus
} from '@shared/pairCompare/types'
import type { PairCompareOptions } from '@shared/pairCompare/types'
import { EVENT_CHANNEL, type MfeEvent } from '@shared/ipc/contract'
import { requireAbsolute } from '../fs/list'
import { copyEntries, trashEntries, deletePermanently } from '../fs/ops'
import { runPairCompare, type ScanProgress } from './scan'
import { revalidatePlan } from './revalidate'

type Session = {
  result: PairComparisonResult | null
  controller: AbortController
  scanning: boolean
}

type PlanRecord = {
  plan: PairSyncPlan
  sessionId: string
}

const sessions = new Map<string, Session>()
const plans = new Map<string, PlanRecord>()

function broadcast(event: MfeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event)
  }
}

function emitProgress(p: ScanProgress): void {
  broadcast({
    type: 'pair-compare-progress',
    payload: p
  })
}

export function disposePairCompareSession(sessionId: string): void {
  const s = sessions.get(sessionId)
  if (s) {
    s.controller.abort()
    sessions.delete(sessionId)
  }
  for (const [pid, rec] of plans) {
    if (rec.sessionId === sessionId) plans.delete(pid)
  }
}

export async function startPairCompare(
  leftRoot: string,
  rightRoot: string,
  options: PairCompareOptions
): Promise<{ sessionId: string }> {
  const left = requireAbsolute(leftRoot)
  const right = requireAbsolute(rightRoot)
  if (isPathUnder(left, right, false) || isPathUnder(right, left, false)) {
    throw new AppError('validation', 'Nested roots are not allowed for pair compare')
  }

  const sessionId = randomUUID()
  const controller = new AbortController()
  sessions.set(sessionId, { result: null, controller, scanning: true })

  void (async () => {
    try {
      const result = await runPairCompare({
        sessionId,
        leftRoot: left,
        rightRoot: right,
        options,
        signal: controller.signal,
        onProgress: emitProgress
      })
      const cur = sessions.get(sessionId)
      if (cur && !cur.controller.signal.aborted) {
        cur.result = result
        cur.scanning = false
        emitProgress({ sessionId, phase: 'done', itemsScanned: result.rows.length })
      }
    } catch (e) {
      const cur = sessions.get(sessionId)
      if (cur) cur.scanning = false
      if (e instanceof Error && e.message === 'cancelled') {
        emitProgress({ sessionId, phase: 'cancelled', itemsScanned: 0 })
      } else {
        emitProgress({
          sessionId,
          phase: 'done',
          itemsScanned: 0,
          currentRelativePath: e instanceof Error ? e.message : String(e)
        })
      }
    }
  })()

  return { sessionId }
}

export async function cancelPairCompare(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId)
  if (!s) return
  s.controller.abort()
  s.scanning = false
}

export async function getPairCompareResult(sessionId: string): Promise<PairComparisonResult> {
  const s = sessions.get(sessionId)
  if (!s) throw new AppError('not-found', 'Comparison session not found')
  if (s.scanning || !s.result) {
    throw new AppError('busy', 'Comparison still running')
  }
  return s.result
}

/** Wait until scan finishes (or throw). Used after start when renderer polls. */
export async function awaitPairCompareResult(
  sessionId: string,
  timeoutMs = 3_600_000
): Promise<PairComparisonResult> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const s = sessions.get(sessionId)
    if (!s) throw new AppError('not-found', 'Comparison session not found')
    if (!s.scanning && s.result) return s.result
    if (!s.scanning && !s.result) {
      throw new AppError('cancelled', 'Comparison cancelled or failed')
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new AppError('busy', 'Comparison timed out')
}

export function buildPairSyncPlan(req: {
  sessionId: string
  direction: PairSyncDirection
  policy: PairSyncPolicy
  scope: PairSyncScope
  selectedRowIds?: string[]
  visibleStatuses?: PairCompareStatus[]
}): PairSyncPlan {
  const s = sessions.get(req.sessionId)
  if (!s?.result) throw new AppError('not-found', 'No comparison result')
  if (req.policy === 'mirror' && s.result.incomplete) {
    throw new AppError('validation', 'Mirror disabled after incomplete scan')
  }
  const planId = randomUUID()
  const plan = buildSyncPlan({
    sessionId: req.sessionId,
    planId,
    direction: req.direction,
    policy: req.policy,
    scope: req.scope,
    leftRoot: s.result.leftRoot,
    rightRoot: s.result.rightRoot,
    rows: s.result.rows,
    selectedRowIds: req.selectedRowIds,
    visibleStatuses: req.visibleStatuses,
    incompleteSource: s.result.incomplete
  })
  plans.set(planId, { plan, sessionId: req.sessionId })
  return plan
}

export async function revalidatePairPlan(planId: string) {
  const rec = plans.get(planId)
  if (!rec) throw new AppError('not-found', 'Plan not found')
  const s = sessions.get(rec.sessionId)
  if (!s?.result) throw new AppError('not-found', 'Session gone')
  const map = new Map(
    s.result.rows.map((r) => [r.id, { left: r.left, right: r.right }] as const)
  )
  return revalidatePlan(rec.plan, map)
}

function assertDestUnderRoot(dest: string, root: string): void {
  if (!isPathUnder(root, dest, false)) {
    throw new AppError('validation', `Destination escapes root: ${dest}`)
  }
}

export async function executePairPlan(req: {
  planId: string
  approvedEntryIds?: string[]
  decisions?: { entryId: string; decision: string }[]
  mirrorAck?: boolean
}): Promise<{
  copied: number
  replaced: number
  created: number
  removed: number
  skipped: number
  failed: number
}> {
  const rec = plans.get(req.planId)
  if (!rec) throw new AppError('not-found', 'Plan not found')
  const plan = rec.plan

  if (plan.policy === 'mirror' && !req.mirrorAck) {
    throw new AppError('validation', 'Mirror requires acknowledgement')
  }

  const validation = await revalidatePairPlan(req.planId)
  if (!validation.ok) {
    throw new AppError(
      'conflict',
      `Plan stale (${validation.staleEntryIds.length} stale, ${validation.missingSourceIds.length} missing)`
    )
  }

  const decisionMap = new Map((req.decisions ?? []).map((d) => [d.entryId, d.decision]))
  const approved = req.approvedEntryIds ? new Set(req.approvedEntryIds) : null

  let copied = 0
  let replaced = 0
  let created = 0
  let removed = 0
  let skipped = 0
  let failed = 0

  // Parents first
  const ordered = [...plan.entries].sort((a, b) => {
    if (a.action === 'create_folder' && b.action !== 'create_folder') return -1
    if (b.action === 'create_folder' && a.action !== 'create_folder') return 1
    return a.relativePath.localeCompare(b.relativePath)
  })

  for (const e of ordered) {
    if (approved && !approved.has(e.id)) {
      skipped++
      continue
    }
    let action = e.action
    const decision = decisionMap.get(e.id)
    if (action === 'conflict') {
      if (!decision || decision === 'skip') {
        skipped++
        continue
      }
      if (decision === 'use_left') {
        action = e.sourcePath && plan.direction !== 'right_to_left' ? 'replace' : 'replace'
      } else if (decision === 'use_right') {
        action = 'replace'
      } else if (decision === 'keep_both' || decision === 'keep_recent') {
        action = 'copy'
      }
    }
    if (action === 'skip') {
      skipped++
      continue
    }

    try {
      if (action === 'create_folder' && e.destinationPath) {
        assertDestUnderRoot(
          e.destinationPath,
          e.destinationPath.toLowerCase().startsWith(plan.leftRoot.toLowerCase())
            ? plan.leftRoot
            : plan.rightRoot
        )
        await fsp.mkdir(e.destinationPath, { recursive: true })
        created++
      } else if ((action === 'copy' || action === 'replace') && e.sourcePath && e.destinationPath) {
        const destDir = path.dirname(e.destinationPath)
        assertDestUnderRoot(
          e.destinationPath,
          e.destinationPath.toLowerCase().startsWith(plan.leftRoot.toLowerCase())
            ? plan.leftRoot
            : plan.rightRoot
        )
        await fsp.mkdir(destDir, { recursive: true })
        await copyEntries([e.sourcePath], destDir, action === 'replace' ? 'replace' : 'rename')
        if (action === 'replace') replaced++
        else copied++
      } else if (action === 'trash' && e.destinationPath) {
        const underRight = isPathUnder(plan.rightRoot, e.destinationPath, false)
        const underLeft = isPathUnder(plan.leftRoot, e.destinationPath, false)
        if (!underRight && !underLeft) throw new AppError('validation', 'Delete outside roots')
        const destNorm = e.destinationPath.replace(/[/\\]+$/, '').toLowerCase()
        if (
          destNorm === plan.leftRoot.replace(/[/\\]+$/, '').toLowerCase() ||
          destNorm === plan.rightRoot.replace(/[/\\]+$/, '').toLowerCase()
        ) {
          throw new AppError('validation', 'Refusing to delete pair root')
        }
        await trashEntries([e.destinationPath])
        removed++
      } else if (action === 'delete_permanent' && e.destinationPath) {
        const underRight = isPathUnder(plan.rightRoot, e.destinationPath, false)
        const underLeft = isPathUnder(plan.leftRoot, e.destinationPath, false)
        if (!underRight && !underLeft) throw new AppError('validation', 'Delete outside roots')
        await deletePermanently([e.destinationPath])
        removed++
      } else {
        skipped++
      }
    } catch {
      failed++
    }
  }

  return { copied, replaced, created, removed, skipped, failed }
}
