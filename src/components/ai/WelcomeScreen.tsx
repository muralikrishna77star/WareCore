import { Package, Truck, Receipt, Factory, ChartColumn, Settings, type LucideIcon } from 'lucide-react'

const CAPABILITIES: { icon: LucideIcon; label: string; iconBg: string; iconColor: string }[] = [
  { icon: Package, label: 'Inventory', iconBg: 'bg-blue-100', iconColor: 'text-blue-600' },
  { icon: Truck, label: 'Transfers', iconBg: 'bg-green-100', iconColor: 'text-green-600' },
  { icon: Receipt, label: 'Purchases', iconBg: 'bg-purple-100', iconColor: 'text-purple-600' },
  { icon: Factory, label: 'Job Work', iconBg: 'bg-orange-100', iconColor: 'text-orange-600' },
  { icon: ChartColumn, label: 'Reports', iconBg: 'bg-teal-100', iconColor: 'text-teal-600' },
  { icon: Settings, label: 'System Help', iconBg: 'bg-gray-200', iconColor: 'text-gray-600' },
]

export function WelcomeScreen() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold text-gray-900">Hello</p>
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
              <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${c.iconBg}`}>
                <c.icon className={`h-4 w-4 ${c.iconColor}`} strokeWidth={2} />
              </span>
              {c.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
