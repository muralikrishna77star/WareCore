'use client'

export function OwnerSignOut() {
  return (
    <button
      type="button"
      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
      onClick={async () => {
        await fetch('/api/owner/login', { method: 'DELETE' })
        window.location.href = '/owner/login'
      }}
    >
      Sign out
    </button>
  )
}
