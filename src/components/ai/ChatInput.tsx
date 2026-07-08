'use client'

import { Mic, Paperclip, Send } from 'lucide-react'

export function ChatInput({
  value,
  onChange,
  onSend,
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim()) onSend()
    }
  }

  return (
    <div className="flex items-end gap-2 border-t bg-white p-3">
      <button
        type="button"
        disabled
        title="Attachments — coming soon"
        className="rounded-lg p-2 text-gray-300 disabled:cursor-not-allowed"
      >
        <Paperclip className="h-5 w-5" />
      </button>
      <button
        type="button"
        disabled
        title="Voice input — coming soon"
        className="rounded-lg p-2 text-gray-300 disabled:cursor-not-allowed"
      >
        <Mic className="h-5 w-5" />
      </button>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about WareCore…"
        rows={1}
        className="max-h-32 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => value.trim() && onSend()}
        disabled={!value.trim()}
        aria-label="Send"
        className="rounded-lg bg-blue-600 p-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        <Send className="h-5 w-5" />
      </button>
    </div>
  )
}
