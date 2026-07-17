'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Minus, X, History } from 'lucide-react'
import { WelcomeScreen } from '@/components/ai/WelcomeScreen'
import { SuggestionCards } from '@/components/ai/SuggestionCards'
import { ChatInput } from '@/components/ai/ChatInput'
import { ChatMessage } from '@/components/ai/ChatMessage'
import { ConversationList } from '@/components/ai/ConversationList'
import { useCopilotChat } from '@/hooks/useCopilotChat'
import { useCopilotConversations } from '@/hooks/useCopilotConversations'

const MIN_WIDTH = 320
const MAX_WIDTH = 640
const MIN_HEIGHT = 400
const DEFAULT_WIDTH = 360
const DEFAULT_HEIGHT = 560
const HISTORY_SIDEBAR_WIDTH = 224 // matches ConversationList's w-56

export default function CopilotPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const bottomRef = useRef<HTMLDivElement>(null)

  const chat = useCopilotChat()
  const conversations = useCopilotConversations()

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen) conversations.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !chat.isStreaming) {
      conversations.refresh()
    }
    wasStreamingRef.current = chat.isStreaming
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.isStreaming])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.messages])

  const handleSend = () => {
    const text = draft.trim()
    if (!text) return
    chat.sendMessage(text)
    setDraft('')
  }

  const handleNewChat = () => {
    chat.newChat()
    setDraft('')
    setShowHistory(false)
  }

  const handleSelectConversation = async (id: string) => {
    const loaded = await conversations.selectConversation(id)
    chat.hydrate(id, loaded)
    setDraft('')
    setShowHistory(false)
  }

  const handleDeleteConversation = async (id: string) => {
    await conversations.remove(id)
    if (id === chat.conversationId) handleNewChat()
  }

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startSize = { ...size }
    const maxHeight = Math.min(window.innerHeight * 0.9, 900)

    const onMove = (moveEvent: MouseEvent) => {
      const dx = startX - moveEvent.clientX
      const dy = startY - moveEvent.clientY
      setSize({
        width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startSize.width + dx)),
        height: Math.min(maxHeight, Math.max(MIN_HEIGHT, startSize.height + dy)),
      })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const lastAssistantId = [...chat.messages].reverse().find((m) => m.role === 'assistant')?.id

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="WareCore Copilot"
      style={{ width: size.width + (showHistory ? HISTORY_SIDEBAR_WIDTH : 0), height: size.height }}
      className={`fixed bottom-48 right-2 z-50 flex max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl transition-[opacity,transform] duration-200 ease-out lg:bottom-40 lg:right-4 ${
        isOpen ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-2 scale-95 opacity-0'
      }`}
    >
      {/* Resize handle — panel is anchored bottom-right, so dragging up-left grows it */}
      <div
        onMouseDown={handleResizeStart}
        title="Resize"
        className="absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize"
      >
        <div className="absolute left-1 top-1 h-2 w-2 border-l-2 border-t-2 border-gray-300" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="flex items-center gap-1.5 font-semibold text-gray-900">
            🧠 WareCore Copilot
          </p>
          <p className="flex items-center gap-1.5 text-xs text-gray-500">
            AI Warehouse Assistant
            <span className="inline-flex items-center gap-1 text-green-600">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              Connected
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            title="Chat history"
            className={`rounded-lg p-1.5 hover:bg-gray-100 ${showHistory ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <History className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            title="New Chat"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Minimize"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {showHistory && (
          <ConversationList
            conversations={conversations.conversations}
            activeConversationId={chat.conversationId}
            loading={conversations.loading}
            onSelect={handleSelectConversation}
            onRename={conversations.rename}
            onDelete={handleDeleteConversation}
            onNewChat={handleNewChat}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {chat.messages.length === 0 ? (
              <>
                <WelcomeScreen />
                <SuggestionCards onPick={setDraft} />
              </>
            ) : (
              chat.messages.map((m) => (
                <ChatMessage
                  key={m.id}
                  message={m}
                  isLastAssistant={m.id === lastAssistantId}
                  onRegenerate={chat.regenerate}
                />
              ))
            )}
            {chat.error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{chat.error}</div>
            )}
            <div ref={bottomRef} />
          </div>

          <ChatInput
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            isStreaming={chat.isStreaming}
            onStop={chat.stop}
          />
        </div>
      </div>
    </div>
  )
}
