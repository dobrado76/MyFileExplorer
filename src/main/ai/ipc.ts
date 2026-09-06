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
  aiChatConversationIdSchema,
  aiChatCreateConversationSchema,
  aiChatCreateTopicSchema,
  aiChatDeleteTopicSchema,
  aiChatMoveConversationSchema,
  aiChatMoveTopicSchema,
  aiChatOpenSchema,
  aiChatRenameConversationSchema,
  aiChatRenameTopicSchema,
  aiChatSendMessageSchema,
  aiChatSetUiSchema,
  aiChatStartFromStarterSchema,
  mediaAskAiStartSchema
} from '@shared/schemas/aiChat'
import {
  deleteAiProvider,
  listAiModels,
  listAiProviders,
  resolveProviderForUi,
  testAiConnection,
  upsertAiProvider
} from './provider'
import { fixScript, generateScript, modifyScript } from './generate'
import {
  createAiChatConversation,
  createAiChatTopic,
  deleteAiChatConversation,
  deleteAiChatTopic,
  getAiChatConversation,
  getAiChatSnapshot,
  getTopicBySystemKey,
  moveAiChatConversation,
  moveAiChatTopic,
  renameAiChatConversation,
  renameAiChatTopic,
  setAiChatUi
} from './chatStore'
import { sendAiChatMessage, startAiChatFromStarter, startMediaAskAi } from './chatService'
import { openAiChatWindow } from './chatWindow'

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

  handle(
    IPC.aiChatOpen,
    z
      .object({
        topicSystemKey: aiChatOpenSchema.shape.topicSystemKey,
        conversationId: aiChatOpenSchema.shape.conversationId
      })
      .partial()
      .optional(),
    (req) => {
      const topicId = req?.topicSystemKey
        ? getTopicBySystemKey(req.topicSystemKey).id
        : undefined
      return openAiChatWindow({
        conversationId: req?.conversationId,
        topicId
      })
    }
  )
  handle(IPC.aiChatSnapshot, emptySchema, () => getAiChatSnapshot())
  handle(IPC.aiChatCreateTopic, aiChatCreateTopicSchema, (req) => ({
    topic: createAiChatTopic(req.name, req.parentId ?? null)
  }))
  handle(IPC.aiChatRenameTopic, aiChatRenameTopicSchema, (req) => ({
    topic: renameAiChatTopic(req.id, req.name)
  }))
  handle(IPC.aiChatMoveTopic, aiChatMoveTopicSchema, (req) => ({
    topic: moveAiChatTopic(req.id, req.parentId, req.beforeId)
  }))
  handle(IPC.aiChatDeleteTopic, aiChatDeleteTopicSchema, (req) => deleteAiChatTopic(req.id))
  handle(IPC.aiChatCreateConversation, aiChatCreateConversationSchema, (req) => ({
    conversation: createAiChatConversation(req.topicId, req.title)
  }))
  handle(IPC.aiChatRenameConversation, aiChatRenameConversationSchema, (req) => ({
    conversation: renameAiChatConversation(req.id, req.title)
  }))
  handle(IPC.aiChatMoveConversation, aiChatMoveConversationSchema, (req) => ({
    conversation: moveAiChatConversation(req.id, req.topicId)
  }))
  handle(IPC.aiChatDeleteConversation, aiChatConversationIdSchema, (req) =>
    deleteAiChatConversation(req.id)
  )
  handle(IPC.aiChatGetConversation, aiChatConversationIdSchema, (req) => ({
    conversation: getAiChatConversation(req.id)
  }))
  handle(IPC.aiChatSendMessage, aiChatSendMessageSchema, async (req) => sendAiChatMessage(req))
  handle(IPC.aiChatStartFromStarter, aiChatStartFromStarterSchema, async (req) =>
    startAiChatFromStarter(req)
  )
  handle(IPC.aiChatSetUi, aiChatSetUiSchema, (req) => ({ ui: setAiChatUi(req) }))
  handle(IPC.mediaMetadataAskAi, mediaAskAiStartSchema, async (req) => startMediaAskAi(req))
}
