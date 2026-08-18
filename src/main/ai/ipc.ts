import { z } from 'zod'
import { IPC } from '@shared/ipc/contract'
import {
  aiFixRequestSchema,
  aiGenerateRequestSchema,
  aiModifyRequestSchema,
  aiProviderIdSchema,
  aiProviderUpsertSchema
} from '@shared/schemas/ai'
import {
  deleteAiProvider,
  listAiModels,
  listAiProviders,
  resolveProviderForUi,
  testAiConnection,
  upsertAiProvider
} from './provider'
import { fixScript, generateScript, modifyScript } from './generate'

const emptySchema = z.union([z.undefined(), z.null(), z.object({}).strict()]).optional()

type Handle = <S extends z.ZodType, T>(
  channel: string,
  schema: S,
  fn: (req: z.infer<S>) => Promise<T> | T
) => void

function localFlag(providerId?: string): boolean {
  return resolveProviderForUi(providerId)?.local ?? false
}

export function registerAiIpc(handle: Handle): void {
  handle(IPC.aiListProviders, emptySchema, () => ({ providers: listAiProviders() }))
  handle(IPC.aiUpsertProvider, aiProviderUpsertSchema, (req) => ({
    provider: upsertAiProvider(req)
  }))
  handle(IPC.aiDeleteProvider, aiProviderIdSchema, (req) => {
    deleteAiProvider(req.id)
    return { deleted: true as const }
  })
  handle(IPC.aiTestConnection, aiProviderIdSchema, (req) => testAiConnection(req.id))
  handle(IPC.aiListModels, aiProviderIdSchema, async (req) => ({
    models: await listAiModels(req.id)
  }))
  handle(IPC.aiGenerate, aiGenerateRequestSchema, async (req) => ({
    script: await generateScript(req),
    local: localFlag(req.providerId)
  }))
  handle(IPC.aiModify, aiModifyRequestSchema, async (req) => ({
    script: await modifyScript(req),
    local: localFlag(req.providerId)
  }))
  handle(IPC.aiFix, aiFixRequestSchema, async (req) => ({
    script: await fixScript(req),
    local: localFlag(req.providerId)
  }))
}
