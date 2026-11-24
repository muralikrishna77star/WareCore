// Header and footer of WareCore's public website (www.warecore.space).
// Used by the (website) layout and by the home page, which src/app/page.tsx
// renders outside that layout.
import Link from 'next/link'

export function WebsiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/60 bg-white/70 backdrop-blur-xl backdrop-saturate-150 shadow-[0_1px_0_rgb(255_255_255/0.8)_inset,0_6px_24px_-12px_rgb(30_64_175/0.25)] print:hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="wc-gloss h-8 w-8 rounded-lg bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-700 flex items-center justify-center">
            <span className="relative text-white font-bold text-sm">W</span>
          </div>
          <span className="font-bold text-lg bg-gradient-to-r from-slate-900 via-blue-800 to-slate-900 bg-clip-text text-transparent">WareCore</span>
        </Link>
        <Link href="/tour" className="wc-shine wc-gloss md:hidden inline-flex items-center rounded-lg bg-gradient-to-b from-blue-500 to-blue-700 px-3 py-2 text-sm font-medium text-white">
          <span className="relative">Product Tour</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/tour" className="text-sm font-medium text-blue-700 hover:text-blue-900">Product Tour</Link>
          <Link href="/#features" className="text-sm text-gray-600 hover:text-gray-900">Features</Link>
          <Link href="/#products" className="text-sm text-gray-600 hover:text-gray-900">Products</Link>
          <Link href="/#contact" className="text-sm text-gray-600 hover:text-gray-900">Contact</Link>
          <Link href="/login" className="wc-shine wc-gloss inline-flex items-center rounded-lg bg-gradient-to-b from-blue-500 to-blue-700 px-4 py-2 text-sm font-medium text-white hover:from-blue-500 hover:to-blue-600 transition-colors">
            <span className="relative">Staff Login</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}

export function WebsiteFooter() {
  return (
    <footer className="relative py-8 mt-16 bg-gradient-to-b from-slate-50 to-blue-50/60 print:hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-300 to-transparent" aria-hidden="true" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p className="text-sm text-gray-500">© {new Date().getFullYear()} WareCore. All rights reserved.</p>
      </div>
    </footer>
  )
}
