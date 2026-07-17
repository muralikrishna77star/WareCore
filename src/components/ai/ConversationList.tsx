'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import type { ConversationSummary } from '@/hooks/useCopilotConversations'

export function ConversationList({
  conversations,
  activeConversationId,
  loading,
  onSelect,
  onRename,
  onDelete,
  onNewChat,
}: {
  conversations: ConversationSummary[]
  activeConversationId?: string
  loading: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onNewChat: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const startEditing = (c: ConversationSummary) => {
    setEditingId(c.id)
    setDraftTitle(c.title)
  }

  const commitEdit = () => {
    if (editingId && draftTitle.trim()) {
      onRename(editingId, draftTitle.trim())
    }
    setEditingId(null)
  }

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this chat? This cannot be undone.')) {
      onDelete(id)
    }
  }

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r bg-gray-50">
      <div className="border-b p-2">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {loading && <p className="px-2 py-3 text-xs text-gray-400">Loading…</p>}
        {!loading && conversations.length === 0 && (
          <p className="px-2 py-3 text-xs text-gray-400">No conversations yet.</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group mb-0.5 flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${
              c.id === activeConversationId ? 'bg-blue-100 text-blue-900' : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {editingId === c.id ? (
              <>
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="min-w-0 flex-1 rounded border border-blue-300 px-1 py-0.5 text-sm focus:outline-none"
                />
                <button type="button" onClick={commitEdit} className="shrink-0 p-1 text-gray-500 hover:text-gray-800">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="shrink-0 p-1 text-gray-500 hover:text-gray-800"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="min-w-0 flex-1 truncate text-left"
                  title={c.title}
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => startEditing(c)}
                  title="Rename"
                  className="hidden shrink-0 p-1 text-gray-400 hover:text-gray-700 group-hover:block"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  title="Delete"
                  className="hidden shrink-0 p-1 text-gray-400 hover:text-red-600 group-hover:block"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
