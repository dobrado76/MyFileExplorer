import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { AppError } from '@shared/result'
import {
  MAX_AI_CHAT_MESSAGES_PER_CONVERSATION,
  MAX_AI_CHAT_MESSAGE_CHARS,
  aiChatStoreSchema,
  type AiChatConversation,
  type AiChatMessage,
  type AiChatStoreDocument,
  type AiChatTopic,
  type AiChatTopicSystemKey,
  type AiChatUiState
} from '@shared/schemas/aiChat'
import { topicSubtreeIds } from '@shared/aiChat'
import { JsonStore } from '../store/jsonStore'

function nowIso(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function defaultTopics(): AiChatTopic[] {
  return [
    { id: 'topic_media', name: 'Media', parentId: null, order: 0, systemKey: 'media' },
    { id: 'topic_general', name: 'General', parentId: null, order: 1, systemKey: 'general' },
    { id: 'topic_help', name: 'Help', parentId: null, order: 2, systemKey: 'help' }
  ]
}

function emptyDocument(): AiChatStoreDocument {
  return aiChatStoreSchema.parse({
    version: 1,
    topics: defaultTopics(),
    conversations: [],
    ui: {
      lastTopicId: 'topic_media',
      lastConversationId: null,
      sidebarWidthPx: 260,
      topicPaneRatio: 0.45,
      expandedTopicIds: []
    }
  })
}

let store: JsonStore<AiChatStoreDocument> | null = null

function chatStore(): JsonStore<AiChatStoreDocument> {
  if (!store) {
    store = new JsonStore(
      path.join(app.getPath('userData'), 'ai-chats', 'index.json'),
      aiChatStoreSchema,
      emptyDocument()
    )
    ensureSystemTopics(store)
  }
  return store
}

/** First run only: seed default folders. Do not re-add topics the user deleted. */
function ensureSystemTopics(s: JsonStore<AiChatStoreDocument>): void {
  const doc = aiChatStoreSchema.parse(s.get())
  if (doc.topics.length > 0) return
  s.replace(aiChatStoreSchema.parse({ ...doc, topics: defaultTopics() }))
}

function systemTopicSeed(key: AiChatTopicSystemKey): Omit<AiChatTopic, 'id' | 'order'> {
  return {
    name: key === 'media' ? 'Media' : key === 'general' ? 'General' : 'Help',
    parentId: null,
    systemKey: key
  }
}

/** Starters need a topic by systemKey; recreate at root if the user deleted it. */
export function ensureTopicForSystemKey(key: AiChatTopicSystemKey): AiChatTopic {
  const existing = getAiChatSnapshot().topics.find((t) => t.systemKey === key)
  if (existing) return existing
  let created: AiChatTopic | null = null
  mutate((doc) => {
    const roots = doc.topics.filter((t) => t.parentId === null)
    const order = roots.reduce((m, t) => Math.max(m, t.order), -1) + 1
    created = {
      id: `topic_${key}`,
      ...systemTopicSeed(key),
      order
    }
    return { ...doc, topics: [...doc.topics, created] }
  })
  return created!
}

function mutate(fn: (doc: AiChatStoreDocument) => AiChatStoreDocument): AiChatStoreDocument {
  const s = chatStore()
  const next = aiChatStoreSchema.parse(fn(aiChatStoreSchema.parse(s.get())))
  s.replace(next)
  return next
}

export function getAiChatSnapshot(): AiChatStoreDocument {
  return aiChatStoreSchema.parse(chatStore().get())
}

export function getTopicBySystemKey(key: AiChatTopicSystemKey): AiChatTopic {
  return ensureTopicForSystemKey(key)
}

export function listAiChatTopics(): AiChatTopic[] {
  return getAiChatSnapshot().topics
}

export function listAiChatConversations(topicId?: string | null): AiChatConversation[] {
  const doc = getAiChatSnapshot()
  let list = doc.conversations
  if (topicId) {
    const ids = topicSubtreeIds(doc.topics, topicId)
    list = list.filter((c) => ids.has(c.topicId))
  }
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function getAiChatConversation(id: string): AiChatConversation {
  const found = getAiChatSnapshot().conversations.find((c) => c.id === id)
  if (!found) throw new AppError('not-found', 'Conversation not found')
  return found
}

export function createAiChatTopic(name: string, parentId: string | null): AiChatTopic {
  const trimmed = name.trim()
  if (!trimmed) throw new AppError('validation', 'Topic name required')
  let created: AiChatTopic | null = null
  mutate((doc) => {
    if (parentId && !doc.topics.some((t) => t.id === parentId)) {
      throw new AppError('not-found', 'Parent topic not found')
    }
    const siblings = doc.topics.filter((t) => t.parentId === parentId)
    const order = siblings.reduce((m, t) => Math.max(m, t.order), -1) + 1
    created = {
      id: newId('topic'),
      name: trimmed.slice(0, 120),
      parentId,
      order
    }
    return { ...doc, topics: [...doc.topics, created] }
  })
  return created!
}

export function renameAiChatTopic(id: string, name: string): AiChatTopic {
  const trimmed = name.trim()
  if (!trimmed) throw new AppError('validation', 'Topic name required')
  let out: AiChatTopic | null = null
  mutate((doc) => {
    const idx = doc.topics.findIndex((t) => t.id === id)
    if (idx < 0) throw new AppError('not-found', 'Topic not found')
    const prev = doc.topics[idx]!
    out = { ...prev, name: trimmed.slice(0, 120) }
    const topics = [...doc.topics]
    topics[idx] = out
    return { ...doc, topics }
  })
  return out!
}

export function moveAiChatTopic(
  id: string,
  parentId: string | null,
  beforeId?: string | null
): AiChatTopic {
  let out: AiChatTopic | null = null
  mutate((doc) => {
    const idx = doc.topics.findIndex((t) => t.id === id)
    if (idx < 0) throw new AppError('not-found', 'Topic not found')
    if (parentId === id) throw new AppError('validation', 'Topic cannot be its own parent')
    if (parentId) {
      if (!doc.topics.some((t) => t.id === parentId)) {
        throw new AppError('not-found', 'Parent topic not found')
      }
      if (topicSubtreeIds(doc.topics, id).has(parentId)) {
        throw new AppError('validation', 'Cannot move a topic into its own subtree')
      }
    }
    if (beforeId) {
      const before = doc.topics.find((t) => t.id === beforeId)
      if (!before) throw new AppError('not-found', 'Before topic not found')
      if (before.parentId !== parentId) {
        throw new AppError('validation', 'Before topic must share the new parent')
      }
      if (beforeId === id) throw new AppError('validation', 'Invalid reorder target')
    }
    const moving = doc.topics[idx]!
    const others = doc.topics.filter((t) => t.id !== id)
    const siblings = others
      .filter((t) => t.parentId === parentId)
      .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.name.localeCompare(b.name)))
    const insertAt = beforeId ? siblings.findIndex((t) => t.id === beforeId) : siblings.length
    const ordered = [...siblings]
    const nextMoving: AiChatTopic = { ...moving, parentId, order: 0 }
    ordered.splice(insertAt < 0 ? ordered.length : insertAt, 0, nextMoving)
    const orderById = new Map(ordered.map((t, i) => [t.id, i]))
    const topics = others.map((t) =>
      t.parentId === parentId && orderById.has(t.id)
        ? { ...t, order: orderById.get(t.id)! }
        : t
    )
    out = { ...nextMoving, order: orderById.get(id)! }
    topics.push(out)
    return { ...doc, topics }
  })
  return out!
}

export function deleteAiChatTopic(id: string): { deleted: true } {
  mutate((doc) => {
    const topic = doc.topics.find((t) => t.id === id)
    if (!topic) throw new AppError('not-found', 'Topic not found')
    const removeIds = topicSubtreeIds(doc.topics, id)
    const remaining = doc.topics.filter((t) => !removeIds.has(t.id))
    let fallbackTopicId = remaining.find((t) => t.systemKey === 'general')?.id
      ?? remaining.find((t) => t.parentId === null)?.id
      ?? remaining[0]?.id
    let topics = remaining
    if (!fallbackTopicId) {
      const seed = {
        id: 'topic_general',
        name: 'General',
        parentId: null,
        order: 0,
        systemKey: 'general' as const
      }
      topics = [seed]
      fallbackTopicId = seed.id
    }
    return {
      ...doc,
      topics,
      conversations: doc.conversations.map((c) =>
        removeIds.has(c.topicId) ? { ...c, topicId: fallbackTopicId! } : c
      ),
      ui: {
        ...doc.ui,
        lastTopicId:
          doc.ui.lastTopicId && removeIds.has(doc.ui.lastTopicId)
            ? fallbackTopicId!
            : doc.ui.lastTopicId
      }
    }
  })
  return { deleted: true }
}

export function createAiChatConversation(
  topicId: string,
  title = 'New chat'
): AiChatConversation {
  let created: AiChatConversation | null = null
  const ts = nowIso()
  mutate((doc) => {
    if (!doc.topics.some((t) => t.id === topicId)) {
      throw new AppError('not-found', 'Topic not found')
    }
    created = {
      id: newId('chat'),
      topicId,
      title: title.trim().slice(0, 200) || 'New chat',
      createdAt: ts,
      updatedAt: ts,
      messages: []
    }
    return {
      ...doc,
      conversations: [created, ...doc.conversations],
      ui: { ...doc.ui, lastTopicId: topicId, lastConversationId: created.id }
    }
  })
  return created!
}

export function renameAiChatConversation(id: string, title: string): AiChatConversation {
  const trimmed = title.trim()
  if (!trimmed) throw new AppError('validation', 'Title required')
  let out: AiChatConversation | null = null
  mutate((doc) => {
    const idx = doc.conversations.findIndex((c) => c.id === id)
    if (idx < 0) throw new AppError('not-found', 'Conversation not found')
    out = {
      ...doc.conversations[idx]!,
      title: trimmed.slice(0, 200),
      updatedAt: nowIso()
    }
    const conversations = [...doc.conversations]
    conversations[idx] = out
    return { ...doc, conversations }
  })
  return out!
}

export function moveAiChatConversation(id: string, topicId: string): AiChatConversation {
  let out: AiChatConversation | null = null
  mutate((doc) => {
    if (!doc.topics.some((t) => t.id === topicId)) {
      throw new AppError('not-found', 'Topic not found')
    }
    const idx = doc.conversations.findIndex((c) => c.id === id)
    if (idx < 0) throw new AppError('not-found', 'Conversation not found')
    out = { ...doc.conversations[idx]!, topicId, updatedAt: nowIso() }
    const conversations = [...doc.conversations]
    conversations[idx] = out
    return {
      ...doc,
      conversations,
      ui: { ...doc.ui, lastTopicId: topicId, lastConversationId: id }
    }
  })
  return out!
}

export function deleteAiChatConversation(id: string): { deleted: true } {
  mutate((doc) => ({
    ...doc,
    conversations: doc.conversations.filter((c) => c.id !== id),
    ui: {
      ...doc.ui,
      lastConversationId: doc.ui.lastConversationId === id ? null : doc.ui.lastConversationId
    }
  }))
  return { deleted: true }
}

export function appendAiChatMessages(
  conversationId: string,
  messages: Omit<AiChatMessage, 'id' | 'createdAt'>[],
  patch?: Partial<Pick<AiChatConversation, 'title' | 'starter' | 'sourceContext'>>
): AiChatConversation {
  let out: AiChatConversation | null = null
  const ts = nowIso()
  mutate((doc) => {
    const idx = doc.conversations.findIndex((c) => c.id === conversationId)
    if (idx < 0) throw new AppError('not-found', 'Conversation not found')
    const prev = doc.conversations[idx]!
    const added: AiChatMessage[] = messages.map((m) => ({
      id: newId('msg'),
      role: m.role,
      content: m.content.slice(0, MAX_AI_CHAT_MESSAGE_CHARS),
      createdAt: ts
    }))
    let nextMessages = [...prev.messages, ...added]
    if (nextMessages.length > MAX_AI_CHAT_MESSAGES_PER_CONVERSATION) {
      const drop = nextMessages.length - MAX_AI_CHAT_MESSAGES_PER_CONVERSATION
      const keepSystem = nextMessages.filter((m) => m.role === 'system').slice(0, 2)
      const rest = nextMessages.filter((m) => m.role !== 'system').slice(drop)
      nextMessages = [...keepSystem, ...rest]
    }
    out = {
      ...prev,
      ...patch,
      messages: nextMessages,
      updatedAt: ts
    }
    const conversations = [...doc.conversations]
    conversations[idx] = out
    return {
      ...doc,
      conversations,
      ui: {
        ...doc.ui,
        lastTopicId: out.topicId,
        lastConversationId: out.id
      }
    }
  })
  return out!
}

export function setAiChatUi(patch: Partial<AiChatUiState>): AiChatUiState {
  let ui: AiChatUiState | null = null
  mutate((doc) => {
    ui = { ...doc.ui, ...patch }
    return { ...doc, ui }
  })
  return ui!
}

export function flushAiChatStore(): void {
  chatStore().flush()
}
