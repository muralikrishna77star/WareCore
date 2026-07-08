'use client'

import { useEffect, useState } from 'react'
import { Plus, Minus, X } from 'lucide-react'
import { WelcomeScreen } from '@/components/ai/WelcomeScreen'
import { SuggestionCards } from '@/components/ai/SuggestionCards'
import { ChatInput } from '@/components/ai/ChatInput'

export default function CopilotPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const handleNewChat = () => {
    setDraft('')
    setNotice(false)
  }

  const handleSend = () => {
    setNotice(true)
    setDraft('')
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="WareCore Copilot"
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl transition-transform duration-300 ease-out md:w-[80%] lg:w-[420px] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
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
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <WelcomeScreen />
          <SuggestionCards onPick={setDraft} />
          {notice && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              🚧 Copilot chat isn&apos;t connected yet — full AI chat is coming in the next phase.
            </div>
          )}
        </div>

        <ChatInput value={draft} onChange={setDraft} onSend={handleSend} />
      </div>
    </>
  )
}
