import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc/contract'
import {
  pairCompareSessionIdSchema,
  pairCompareStartSchema,
  pairExecutePlanSchema,
  pairPlanIdSchema,
  pairSyncBuildPlanSchema
} from '@shared/pairCompare/schemas'
import * as pair from './index'

type Handle = <S extends z.ZodType, T>(
  channel: string,
  schema: S,
  fn: (req: z.infer<S>, event: IpcMainInvokeEvent) => Promise<T> | T
) => void

export function registerPairCompareIpc(handle: Handle): void {
  handle(IPC.pairCompareStart, pairCompareStartSchema, async (req) =>
    pair.startPairCompare(req.leftRoot, req.rightRoot, req.options)
  )

  handle(IPC.pairCompareCancel, pairCompareSessionIdSchema, async (req) => {
    await pair.cancelPairCompare(req.sessionId)
    return { ok: true as const }
  })

  handle(IPC.pairCompareResult, pairCompareSessionIdSchema, async (req) =>
    pair.awaitPairCompareResult(req.sessionId)
  )

  handle(IPC.pairCompareBuildPlan, pairSyncBuildPlanSchema, (req) =>
    pair.buildPairSyncPlan(req)
  )

  handle(IPC.pairCompareRevalidatePlan, pairPlanIdSchema, async (req) =>
    pair.revalidatePairPlan(req.planId)
  )

  handle(IPC.pairCompareExecutePlan, pairExecutePlanSchema, async (req) =>
    pair.executePairPlan(req)
  )

  handle(IPC.pairCompareDispose, pairCompareSessionIdSchema, (req) => {
    pair.disposePairCompareSession(req.sessionId)
    return { ok: true as const }
  })
}
