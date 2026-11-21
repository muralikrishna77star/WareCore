// Shown by the proxy (src/proxy.ts) when an address opens no customer. Must
// not touch any customer's database.

const MESSAGES: Record<string, [string, string]> = {
  unknown: ['No WareCore here', 'This address isn\'t set up for any WareCore customer. Check the address, or ask whoever gave it to you.'],
  suspended: ['This WareCore is switched off', 'Your WareCore has been switched off. Your data is safe. Please contact WareCore to switch it back on.'],
  setup: ['Being set up', 'This WareCore is still being set up. Please try again in a few minutes.'],
  error: ['WareCore is unavailable', 'WareCore can\'t be reached right now. Please try again in a minute.'],
}

export const metadata = { title: 'WareCore' }

export default async function UnavailablePage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams
  const [title, text] = MESSAGES[reason ?? ''] ?? MESSAGES.unknown
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- static local SVG */}
      <img src="/assets/brand/logo-mark.svg" alt="WareCore" className="h-12 w-12" />
      <h1 className="mt-6 text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-2 max-w-md text-gray-600">{text}</p>
    </div>
  )
}
