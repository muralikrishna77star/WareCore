const CAPABILITIES = [
  { icon: '📦', label: 'Inventory' },
  { icon: '🚚', label: 'Transfers' },
  { icon: '🧾', label: 'Purchases' },
  { icon: '🏭', label: 'Job Work' },
  { icon: '📊', label: 'Reports' },
  { icon: '⚙️', label: 'System Help' },
]

export function WelcomeScreen() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-gray-900">Hello 👋</p>
        <p className="text-sm text-gray-700">I&apos;m WareCore Copilot.</p>
      </div>
      <div>
        <p className="mb-2 text-sm text-gray-500">I can help you with</p>
        <div className="grid grid-cols-2 gap-2">
          {CAPABILITIES.map((c) => (
            <div
              key={c.label}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
            >
              <span>{c.icon}</span>
              {c.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
