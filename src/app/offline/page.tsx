'use client'

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="text-6xl mb-4">📦</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re Offline</h1>
        <p className="text-gray-500 text-sm mb-6">
          WareCore needs an internet connection to sync data. Please check your connection and try again.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-left">
          <p className="text-sm font-semibold text-blue-800 mb-2">What you can do:</p>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Check your Wi-Fi or mobile data</li>
            <li>• Move to an area with better signal</li>
            <li>• Connect to your company network</li>
          </ul>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  )
}
