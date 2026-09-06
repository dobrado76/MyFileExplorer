import { z } from 'zod'

export const AI_CHAT_TOPIC_SYSTEM_KEYS = ['media', 'general', 'help'] as const
export type AiChatTopicSystemKey = (typeof AI_CHAT_TOPIC_SYSTEM_KEYS)[number]

export const aiChatTopicSystemKeySchema = z.enum(AI_CHAT_TOPIC_SYSTEM_KEYS)

export const aiChatTopicSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  parentId: z.string().min(1).max(80).nullable(),
  order: z.number().int().catch(0),
  systemKey: aiChatTopicSystemKeySchema.optional()
})
export type AiChatTopic = z.infer<typeof aiChatTopicSchema>

export const aiChatMessageRoleSchema = z.enum(['system', 'user', 'assistant'])

export const aiChatMessageSchema = z.object({
  id: z.string().min(1).max(80),
  role: aiChatMessageRoleSchema,
  content: z.string().max(200_000),
  createdAt: z.string().min(1).max(40)
})
export type AiChatMessage = z.infer<typeof aiChatMessageSchema>

export const aiChatStarterFeatureSchema = z.enum(['media', 'help', 'general'])

/** Compact strip under the title — MFE-supplied identity, not user-typed text. */
export const aiChatSourceContextSchema = z.object({
  feature: aiChatStarterFeatureSchema,
  /** Primary label shown in the strip (title / filename stem — never a path). */
  title: z.string().min(1).max(200),
  /** Secondary chip, e.g. Show / Movie / Document shared with AI */
  detail: z.string().min(1).max(120).optional(),
  glyph: z.enum(['media', 'document', 'file', 'help']).optional()
})
export type AiChatSourceContext = z.infer<typeof aiChatSourceContextSchema>

export const aiChatConversationSchema = z.object({
  id: z.string().min(1).max(80),
  topicId: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  starter: z
    .object({
      feature: aiChatStarterFeatureSchema,
      label: z.string().min(1).max(200)
    })
    .optional(),
  sourceContext: aiChatSourceContextSchema.optional(),
  messages: z.array(aiChatMessageSchema).max(200).catch([])
})
export type AiChatConversation = z.infer<typeof aiChatConversationSchema>

export const aiChatUiStateSchema = z.object({
  lastTopicId: z.string().max(80).nullable().catch(null),
  lastConversationId: z.string().max(80).nullable().catch(null),
  sidebarWidthPx: z.number().int().min(160).max(560).catch(260),
  topicPaneRatio: z.number().min(0.2).max(0.8).catch(0.45),
  /** Folder tree branches left expanded (persisted across window close). */
  expandedTopicIds: z.array(z.string().max(80)).max(200).catch([])
})
export type AiChatUiState = z.infer<typeof aiChatUiStateSchema>

export const aiChatStoreSchema = z.object({
  version: z.literal(1).catch(1),
  topics: z.array(aiChatTopicSchema).max(200).catch([]),
  conversations: z.array(aiChatConversationSchema).max(500).catch([]),
  ui: aiChatUiStateSchema.catch({
    lastTopicId: null,
    lastConversationId: null,
    sidebarWidthPx: 260,
    topicPaneRatio: 0.45,
    expandedTopicIds: []
  })
})
export type AiChatStoreDocument = z.infer<typeof aiChatStoreSchema>

export const MAX_AI_CHAT_MESSAGES_PER_CONVERSATION = 80
export const MAX_AI_CHAT_MESSAGE_CHARS = 32_000
export const MAX_AI_CHAT_MODEL_MESSAGES = 40

export const aiChatOpenSchema = z.object({
  topicSystemKey: aiChatTopicSystemKeySchema.optional(),
  conversationId: z.string().min(1).max(80).optional()
})

export const aiChatStartFromStarterSchema = z.object({
  topicSystemKey: aiChatTopicSystemKeySchema,
  title: z.string().min(1).max(200),
  starterLabel: z.string().min(1).max(200),
  system: z.string().min(1).max(16_000),
  user: z.string().min(1).max(16_000),
  sourceContext: aiChatSourceContextSchema.optional(),
  providerId: z.string().max(80).optional(),
  model: z.string().max(200).optional()
})

export const aiChatSendMessageSchema = z.object({
  conversationId: z.string().min(1).max(80),
  content: z.string().min(1).max(16_000),
  providerId: z.string().max(80).optional(),
  model: z.string().max(200).optional()
})

export const aiChatConversationIdSchema = z.object({
  id: z.string().min(1).max(80)
})

export const aiChatCreateTopicSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().min(1).max(80).nullable().optional()
})

export const aiChatRenameTopicSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120)
})

export const aiChatDeleteTopicSchema = z.object({
  id: z.string().min(1).max(80)
})

export const aiChatMoveTopicSchema = z.object({
  id: z.string().min(1).max(80),
  parentId: z.string().min(1).max(80).nullable(),
  beforeId: z.string().min(1).max(80).nullable().optional()
})

export const aiChatCreateConversationSchema = z.object({
  topicId: z.string().min(1).max(80),
  title: z.string().min(1).max(200).optional()
})

export const aiChatRenameConversationSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(200)
})

export const aiChatMoveConversationSchema = z.object({
  id: z.string().min(1).max(80),
  topicId: z.string().min(1).max(80)
})

export const aiChatSetUiSchema = aiChatUiStateSchema.partial()

export const mediaAskAiQueryIdSchema = z.enum([
  'summary-safe',
  'summary-spoilers',
  'list-safe',
  'list-spoilers'
])
export type MediaAskAiQueryId = z.infer<typeof mediaAskAiQueryIdSchema>

export const mediaAskAiStartSchema = z.object({
  path: z.string().min(1).max(4096),
  queryId: mediaAskAiQueryIdSchema
})
