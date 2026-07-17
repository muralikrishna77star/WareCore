'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Minus, X } from 'lucide-react'
import { WelcomeScreen } from '@/components/ai/WelcomeScreen'
import { SuggestionCards } from '@/components/ai/SuggestionCards'
import { ChatInput } from '@/components/ai/ChatInput'
import { ChatMessage, type Message } from '@/components/ai/ChatMessage'

export default function CopilotPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleNewChat = () => {
    setDraft('')
    setMessages([])
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (!text) return
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setDraft('')
    setLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.error || 'Sorry, something went wrong — try again.' },
        ])
        return
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply, ledger: data.ledger }])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong — try again.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="WareCore Copilot"
      className={`fixed bottom-48 right-2 z-50 flex h-[70vh] max-h-[560px] w-[92vw] max-w-[360px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl transition-all duration-200 ease-out lg:bottom-40 lg:right-4 ${
        isOpen ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-2 scale-95 opacity-0'
      }`}
    >
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
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <>
            <WelcomeScreen />
            <SuggestionCards onPick={setDraft} />
          </>
        ) : (
          <>
            {messages.map((m, i) => (
              <ChatMessage key={i} message={m} />
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-gray-100 px-3 py-2 text-sm text-gray-500">
                  Thinking…
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <ChatInput value={draft} onChange={setDraft} onSend={handleSend} />
    </div>
  )
}
