const STYLES: Record<string, [string, string]> = {
  active: ['Active', 'bg-green-100 text-green-800'],
  suspended: ['Switched off', 'bg-gray-200 text-gray-700'],
  provisioning: ['Setting up', 'bg-amber-100 text-amber-800'],
  failed: ['Set-up failed', 'bg-red-100 text-red-800'],
}

export function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STYLES[status] ?? [status, 'bg-gray-100 text-gray-700']
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}
