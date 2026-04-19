import Link from 'next/link'

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">W</span>
            </div>
            <span className="font-bold text-lg text-gray-900">WareCore</span>
          </div>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/#features" className="text-sm text-gray-600 hover:text-gray-900">Features</Link>
            <Link href="/#products" className="text-sm text-gray-600 hover:text-gray-900">Products</Link>
            <Link href="/#contact" className="text-sm text-gray-600 hover:text-gray-900">Contact</Link>
            <Link href="/login" className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
              Staff Login
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t py-8 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm text-gray-500">© {new Date().getFullYear()} WareCore. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
