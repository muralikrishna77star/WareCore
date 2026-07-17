'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message } from '@/components/ai/ChatMessage'
import type { LedgerBlock } from '@/lib/ai/tools'

type ChatFrame =
  | { type: 'conversation_created'; conversationId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'ledger'; ledger: LedgerBlock }
  | { type: 'done'; conversationId: string; messageId: string }
  | { type: 'error'; message: string }

let localIdSeq = 0
const nextLocalId = () => `local-${++localIdSeq}`

export function useCopilotChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const messagesRef = useRef<Message[]>(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const conversationIdRef = useRef<string | undefined>(conversationId)
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  const abortRef = useRef<AbortController | null>(null)

  const applyFrame = useCallback((frame: ChatFrame, assistantLocalId: string) => {
    switch (frame.type) {
      case 'conversation_created':
        setConversationId(frame.conversationId)
        break
      case 'text_delta':
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantLocalId ? { ...m, content: m.content + frame.text } : m))
        )
        break
      case 'ledger':
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantLocalId ? { ...m, ledger: frame.ledger } : m))
        )
        break
      case 'done':
        setConversationId(frame.conversationId)
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantLocalId ? { ...m, id: frame.messageId, pending: false } : m))
        )
        break
      case 'error':
        setError(frame.message)
        break
    }
  }, [])

  const run = useCallback(
    async (
      payload: {
        messages: { role: string; content: string }[]
        conversationId?: string
        regenerateMessageId?: string
      },
      assistantLocalId: string
    ) => {
      const controller = new AbortController()
      abortRef.current = controller
      setIsStreaming(true)
      setError(null)

      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? 'Chat request failed')
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            applyFrame(JSON.parse(line) as ChatFrame, assistantLocalId)
          }
        }
        if (buffer.trim()) {
          applyFrame(JSON.parse(buffer) as ChatFrame, assistantLocalId)
        }
      } catch (err) {
        // An aborted fetch (explicit Stop) is an intentional cancel, not a failure.
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Something went wrong')
        }
      } finally {
        setIsStreaming(false)
        abortRef.current = null
        setMessages((prev) => prev.map((m) => (m.id === assistantLocalId ? { ...m, pending: false } : m)))
      }
    },
    [applyFrame]
  )

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isStreaming) return

      const userMessage: Message = { id: nextLocalId(), role: 'user', content: trimmed }
      const assistantLocalId = nextLocalId()
      const assistantMessage: Message = { id: assistantLocalId, role: 'assistant', content: '', pending: true }

      setMessages((prev) => [...prev, userMessage, assistantMessage])

      const history = [...messagesRef.current, userMessage].map((m) => ({ role: m.role, content: m.content }))
      run({ messages: history, conversationId: conversationIdRef.current }, assistantLocalId)
    },
    [isStreaming, run]
  )

  const regenerate = useCallback(() => {
    if (isStreaming) return
    const current = messagesRef.current
    const idx = current.map((m) => m.role).lastIndexOf('assistant')
    if (idx === -1) return

    const oldAssistantMessage = current[idx]
    const historyUpTo = current.slice(0, idx)

    const assistantLocalId = nextLocalId()
    const newAssistantMessage: Message = { id: assistantLocalId, role: 'assistant', content: '', pending: true }

    setMessages([...historyUpTo, newAssistantMessage])

    run(
      {
        messages: historyUpTo.map((m) => ({ role: m.role, content: m.content })),
        conversationId: conversationIdRef.current,
        regenerateMessageId: oldAssistantMessage.id,
      },
      assistantLocalId
    )
  }, [isStreaming, run])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const hydrate = useCallback((id: string, loadedMessages: Message[]) => {
    abortRef.current?.abort()
    setConversationId(id)
    setMessages(loadedMessages)
    setError(null)
  }, [])

  const newChat = useCallback(() => {
    abortRef.current?.abort()
    setConversationId(undefined)
    setMessages([])
    setError(null)
  }, [])

  return { messages, conversationId, isStreaming, error, sendMessage, regenerate, stop, hydrate, newChat }
}
