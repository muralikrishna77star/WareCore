'use client'

import { useCallback, useState } from 'react'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  GET_MY_AI_CONVERSATIONS_QUERY,
  GET_AI_CONVERSATION_MESSAGES_QUERY,
  RENAME_AI_CONVERSATION_MUTATION,
  DELETE_AI_CONVERSATION_MUTATION,
} from '@/lib/hasura/queries'
import type { Message } from '@/components/ai/ChatMessage'

export type ConversationSummary = {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export function useCopilotConversations() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const { data } = await hasuraFetch<{ ai_conversations: ConversationSummary[] }>(
      GET_MY_AI_CONVERSATIONS_QUERY
    )
    setConversations(data?.ai_conversations ?? [])
    setLoading(false)
  }, [])

  const selectConversation = useCallback(async (id: string): Promise<Message[]> => {
    const { data } = await hasuraFetch<{
      ai_messages: { id: string; role: 'user' | 'assistant'; content: string; ledger: unknown }[]
    }>(GET_AI_CONVERSATION_MESSAGES_QUERY, { conversation_id: id })

    return (data?.ai_messages ?? []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      ledger: (m.ledger ?? undefined) as Message['ledger'],
    }))
  }, [])

  const rename = useCallback(async (id: string, title: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
    await hasuraFetch(RENAME_AI_CONVERSATION_MUTATION, {
      id,
      title,
      updated_at: new Date().toISOString(),
    })
  }, [])

  const remove = useCallback(async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id))
    await hasuraFetch(DELETE_AI_CONVERSATION_MUTATION, { id })
  }, [])

  return { conversations, loading, refresh, selectConversation, rename, remove }
}
