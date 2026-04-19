import Link from 'next/link'

export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className="bg-gradient-to-br from-blue-600 to-blue-800 text-white py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl font-bold mb-6">
            Steel Warehouse Management,<br />
            <span className="text-blue-200">Simplified</span>
          </h1>
          <p className="text-xl text-blue-100 mb-10 max-w-2xl mx-auto">
            Centralized inventory tracking, inter-company transfers, job work management, and dispatch — for steel processing businesses.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login" className="inline-flex items-center justify-center rounded-xl bg-white text-blue-700 font-semibold px-8 py-3 hover:bg-blue-50 transition-colors">
              Staff Login →
            </Link>
            <a href="#features" className="inline-flex items-center justify-center rounded-xl border border-blue-400 text-white font-semibold px-8 py-3 hover:bg-blue-700 transition-colors">
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">Everything You Need</h2>
          <p className="text-center text-gray-500 mb-12 max-w-2xl mx-auto">
            Purpose-built for steel processing companies managing multiple entities and warehouses.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: '📋', title: 'Bill Entry', desc: 'Record inward purchase bills with line-item material details, quantities, and rates.' },
              { icon: '📦', title: 'Live Inventory', desc: 'Real-time stock levels per company, warehouse, material type, and size.' },
              { icon: '↔️', title: 'Transfers', desc: 'Move material between sister companies and warehouses with full audit trail.' },
              { icon: '🏭', title: 'Job Work', desc: 'Track material sent for slitting, shearing, and other processing with return tracking.' },
              { icon: '🚚', title: 'Dispatch', desc: 'Manage sales dispatches with vehicle tracking and auto stock deduction.' },
              { icon: '📈', title: 'Reports', desc: 'Comprehensive reports on stock, movements, and business performance.' },
              { icon: '🔒', title: 'Role-based Access', desc: 'Fine-grained permissions: Admin, Company Manager, Warehouse Manager, and more.' },
              { icon: '📱', title: 'Mobile Ready', desc: 'Works on phone and tablet. Install as an app on Android and iOS.' },
              { icon: '☁️', title: 'Cloud Hosted', desc: 'Hosted on Vercel and Supabase. Always available, always backed up.' },
            ].map((f) => (
              <div key={f.title} className="bg-white rounded-xl border p-6 hover:shadow-md transition-shadow">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Products / Material Types */}
      <section id="products" className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">Materials We Track</h2>
          <p className="text-center text-gray-500 mb-12">
            WareCore handles all common steel types used in fabrication and processing.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {['CR Coil', 'GI Sheet', 'GA Sheet', 'HR Coil', 'Painted Coil', 'Scrap', 'Channels', 'Custom Fabrication'].map((m) => (
              <div key={m} className="rounded-xl border bg-gray-50 px-4 py-3 text-center">
                <p className="font-medium text-gray-800">{m}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-20 px-4 bg-gray-50">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Get in Touch</h2>
          <p className="text-gray-500 mb-8">Have questions? Contact our team for a demo or support.</p>
          <div className="bg-white rounded-xl border p-8 space-y-4 text-left">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase mb-1">Email</p>
              <p className="text-gray-700">admin@warecore.in</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase mb-1">Phone</p>
              <p className="text-gray-700">+91 98765 43210</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
