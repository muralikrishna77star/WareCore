import { hasuraQuery, hasuraMutation } from '@/lib/hasura/server'
import type { LedgerBlock } from '@/lib/ai/tools'

const CREATE_CONVERSATION = `
  mutation CreateAiConversation($created_by: uuid!, $title: String!) {
    insert_ai_conversations_one(object: {created_by: $created_by, title: $title}) { id }
  }
`

const INSERT_MESSAGE = `
  mutation InsertAiMessage($conversation_id: uuid!, $role: String!, $content: String!, $ledger: jsonb) {
    insert_ai_messages_one(object: {
      conversation_id: $conversation_id
      role: $role
      content: $content
      ledger: $ledger
    }) { id }
  }
`

const TOUCH_CONVERSATION = `
  mutation TouchAiConversation($id: uuid!, $updated_at: timestamptz!) {
    update_ai_conversations_by_pk(pk_columns: {id: $id}, _set: {updated_at: $updated_at}) { id }
  }
`

const DELETE_MESSAGE_FOR_REGENERATE = `
  mutation DeleteAiMessageForRegenerate($id: uuid!, $conversation_id: uuid!) {
    delete_ai_messages(where: {id: {_eq: $id}, conversation_id: {_eq: $conversation_id}}) {
      affected_rows
    }
  }
`

const GET_CONVERSATION_OWNER = `
  query GetAiConversationOwner($id: uuid!) {
    ai_conversations_by_pk(id: $id) { created_by }
  }
`

/** Title = first ~40 chars of the opening message — no separate rename prompt needed at creation. */
export async function createConversation(userId: string, firstUserMessage: string): Promise<{ id: string }> {
  const trimmed = firstUserMessage.trim()
  const title = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed || 'New chat'
  const result = await hasuraMutation(CREATE_CONVERSATION, { created_by: userId, title })
  return result.insert_ai_conversations_one
}

export async function insertMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  ledger?: LedgerBlock
): Promise<{ id: string }> {
  const result = await hasuraMutation(INSERT_MESSAGE, {
    conversation_id: conversationId,
    role,
    content,
    ledger: ledger ?? null,
  })
  return result.insert_ai_messages_one
}

export async function touchConversation(conversationId: string): Promise<void> {
  await hasuraMutation(TOUCH_CONVERSATION, { id: conversationId, updated_at: new Date().toISOString() })
}

/** Removes the previous assistant reply being replaced by a regenerate — scoped to the
 *  conversation as defense in depth on top of the route's own ownership check. */
export async function deleteMessageForRegenerate(conversationId: string, messageId: string): Promise<void> {
  await hasuraMutation(DELETE_MESSAGE_FOR_REGENERATE, { id: messageId, conversation_id: conversationId })
}

export async function getConversationOwner(conversationId: string): Promise<string | null> {
  const result = await hasuraQuery(GET_CONVERSATION_OWNER, { id: conversationId })
  return result.ai_conversations_by_pk?.created_by ?? null
}
