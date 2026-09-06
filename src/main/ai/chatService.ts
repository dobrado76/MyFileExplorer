import path from 'node:path'
import fsp from 'node:fs/promises'
import { AppError } from '@shared/result'
import { redactPathsInText } from '@shared/scriptDestructive'
import {
  MAX_AI_CHAT_MODEL_MESSAGES,
  type AiChatConversation,
  type AiChatTopicSystemKey,
  type MediaAskAiQueryId
} from '@shared/schemas/aiChat'
import {
  buildMediaAskAiSystemPrompt,
  buildMediaAskAiUserPrompt,
  mediaAskAiCardFromMeta,
  mediaAskAiConversationTitle,
  mediaAskAiMenuItems,
  mediaAskAiSourceContext,
  resolveMediaAskAiKind
} from '@shared/mediaAskAi'
import { requireAbsolute } from '../fs/list'
import { readMediaMetadata } from '../mediaMetadata/store'
import { normalizeEpisodeFields } from '@shared/mediaMetadata'
import { completeChatMessages, resolveProviderForUi } from './provider'
import {
  appendAiChatMessages,
  createAiChatConversation,
  getAiChatConversation,
  getTopicBySystemKey
} from './chatStore'
import { openAiChatWindow, focusAiChatConversation } from './chatWindow'

function toModelMessages(
  conversation: AiChatConversation
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const msgs = conversation.messages
    .filter((m) => m.content.trim())
    .map((m) => ({
      role: m.role,
      content: redactPathsInText(m.content)
    }))
  if (msgs.length <= MAX_AI_CHAT_MODEL_MESSAGES) return msgs
  const system = msgs.filter((m) => m.role === 'system').slice(0, 2)
  const rest = msgs.filter((m) => m.role !== 'system')
  const keep = rest.slice(-(MAX_AI_CHAT_MODEL_MESSAGES - system.length))
  return [...system, ...keep]
}

async function runCompletion(
  conversationId: string,
  opts?: { providerId?: string; model?: string }
): Promise<AiChatConversation> {
  const conversation = getAiChatConversation(conversationId)
  const reply = await completeChatMessages({
    providerId: opts?.providerId,
    model: opts?.model,
    messages: toModelMessages(conversation)
  })
  return appendAiChatMessages(conversationId, [{ role: 'assistant', content: reply }])
}

export async function startAiChatFromStarter(input: {
  topicSystemKey: AiChatTopicSystemKey
  title: string
  starterLabel: string
  system: string
  user: string
  sourceContext?: AiChatConversation['sourceContext']
  providerId?: string
  model?: string
}): Promise<{ conversation: AiChatConversation; local: boolean }> {
  const topic = getTopicBySystemKey(input.topicSystemKey)
  const conversation = createAiChatConversation(topic.id, input.title)
  appendAiChatMessages(
    conversation.id,
    [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user }
    ],
    {
      starter: {
        feature:
          input.topicSystemKey === 'help'
            ? 'help'
            : input.topicSystemKey === 'media'
              ? 'media'
              : 'general',
        label: input.starterLabel
      },
      ...(input.sourceContext ? { sourceContext: input.sourceContext } : {})
    }
  )
  openAiChatWindow({ conversationId: conversation.id, topicId: topic.id })
  focusAiChatConversation(conversation.id)
  const updated = await runCompletion(conversation.id, {
    providerId: input.providerId,
    model: input.model
  })
  focusAiChatConversation(updated.id)
  return {
    conversation: updated,
    local: resolveProviderForUi(input.providerId)?.local ?? false
  }
}

export async function sendAiChatMessage(input: {
  conversationId: string
  content: string
  providerId?: string
  model?: string
}): Promise<{ conversation: AiChatConversation; local: boolean }> {
  const text = input.content.trim()
  if (!text) throw new AppError('validation', 'Message required')
  appendAiChatMessages(input.conversationId, [{ role: 'user', content: text }])
  const updated = await runCompletion(input.conversationId, {
    providerId: input.providerId,
    model: input.model
  })
  focusAiChatConversation(updated.id)
  return {
    conversation: updated,
    local: resolveProviderForUi(input.providerId)?.local ?? false
  }
}

export async function startMediaAskAi(input: {
  path: string
  queryId: MediaAskAiQueryId
  providerId?: string
  model?: string
}): Promise<{ conversation: AiChatConversation; local: boolean }> {
  const abs = requireAbsolute(input.path)
  if (abs.toLowerCase().startsWith('mfe-remote://')) {
    throw new AppError('validation', 'Ask AI is not available on remote paths')
  }
  let st
  try {
    st = await fsp.stat(abs)
  } catch {
    throw new AppError('not-found', 'Path not found')
  }
  const raw = await readMediaMetadata(abs)
  if (!raw) {
    throw new AppError(
      'validation',
      'No media metadata on this item. Extract or download metadata first.'
    )
  }
  const name = path.basename(abs)
  const meta = normalizeEpisodeFields(raw, name)
  const kind = resolveMediaAskAiKind({
    isDirectory: st.isDirectory(),
    folderOrFileName: name,
    meta
  })
  if (!kind) {
    throw new AppError(
      'validation',
      'No media metadata title on this item. Extract or download metadata first.'
    )
  }
  const card = mediaAskAiCardFromMeta(kind, meta, name)
  const menu = mediaAskAiMenuItems(kind)
  const item = menu.find((m) => m.queryId === input.queryId) ?? menu[0]!
  return startAiChatFromStarter({
    topicSystemKey: 'media',
    title: mediaAskAiConversationTitle(card),
    starterLabel: item.label,
    system: buildMediaAskAiSystemPrompt(input.queryId, kind, card),
    user: buildMediaAskAiUserPrompt(card, input.queryId),
    sourceContext: mediaAskAiSourceContext(card),
    providerId: input.providerId,
    model: input.model
  })
}
