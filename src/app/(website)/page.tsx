import Link from 'next/link'
import {
  ArrowRight, ClipboardList, Package, ArrowLeftRight, Factory, Truck,
  TrendingUp, ShieldCheck, Smartphone, Cloud, PlayCircle, type LucideIcon,
} from 'lucide-react'
import { SALES_CONTACT, TOUR_SLIDES } from '@/lib/marketing/productTour'

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
            <Link href="/tour" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white text-blue-700 font-semibold px-8 py-3 hover:bg-blue-50 transition-colors">
              <PlayCircle className="h-5 w-5" /> Take the Product Tour
            </Link>
            <Link href="/login" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-400 text-white font-semibold px-8 py-3 hover:bg-blue-700 transition-colors">
              Staff Login <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="mt-4 text-sm text-blue-200">{TOUR_SLIDES.length} slides · about 3 minutes · no sign-up needed</p>
        </div>
      </section>

      {/* Product tour teaser */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">See it in action</p>
            <h2 className="text-3xl font-bold text-gray-900 mb-4">From purchase bill to vendor balance, in one guided tour</h2>
            <p className="text-gray-600 mb-6">
              Walk through the screens your team will use every day — live inventory, job work, vendor-to-vendor
              transfers, direct sales from vendors, stock statements and the data integrity control centre.
            </p>
            <Link href="/tour" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 text-white font-semibold px-6 py-3 hover:bg-blue-700 transition-colors">
              Go through the tour <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <Link href="/tour" className="group block rounded-xl border shadow-lg overflow-hidden" aria-label="Open the Product Tour">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/tour/vendor-movements.jpg"
              alt="Vendorwise Stock Movement report from the WareCore demo"
              width={1440}
              height={900}
              className="w-full h-auto group-hover:scale-[1.02] transition-transform duration-300"
            />
          </Link>
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
            {(
              [
                { icon: ClipboardList, iconBg: 'bg-blue-100', iconColor: 'text-blue-600', title: 'Bill Entry', desc: 'Record inward purchase bills with line-item material details, quantities, and rates.' },
                { icon: Package, iconBg: 'bg-green-100', iconColor: 'text-green-600', title: 'Live Inventory', desc: 'Real-time stock levels per company, warehouse, material type, and size.' },
                { icon: ArrowLeftRight, iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600', title: 'Transfers', desc: 'Move material between sister companies and warehouses with full audit trail.' },
                { icon: Factory, iconBg: 'bg-orange-100', iconColor: 'text-orange-600', title: 'Job Work', desc: 'Track material sent for slitting, shearing, and other processing with return tracking.' },
                { icon: Truck, iconBg: 'bg-red-100', iconColor: 'text-red-600', title: 'Dispatch', desc: 'Manage sales dispatches with vehicle tracking and auto stock deduction.' },
                { icon: TrendingUp, iconBg: 'bg-teal-100', iconColor: 'text-teal-600', title: 'Reports', desc: 'Comprehensive reports on stock, movements, and business performance.' },
                { icon: ShieldCheck, iconBg: 'bg-purple-100', iconColor: 'text-purple-600', title: 'Role-based Access', desc: 'Fine-grained permissions: Admin, Company Manager, Warehouse Manager, and more.' },
                { icon: Smartphone, iconBg: 'bg-cyan-100', iconColor: 'text-cyan-600', title: 'Mobile Ready', desc: 'Works on phone and tablet. Install as an app on Android and iOS.' },
                { icon: Cloud, iconBg: 'bg-sky-100', iconColor: 'text-sky-600', title: 'Cloud Hosted', desc: 'Use it from any browser, with full backup and restore. A desktop edition can also run on a single PC.' },
              ] satisfies { icon: LucideIcon; iconBg: string; iconColor: string; title: string; desc: string }[]
            ).map((f) => (
              <div key={f.title} className="bg-white rounded-xl border p-6 hover:shadow-md transition-shadow">
                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl mb-3 ${f.iconBg}`}>
                  <f.icon className={`h-5 w-5 ${f.iconColor}`} strokeWidth={2} />
                </span>
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
              <a href={`mailto:${SALES_CONTACT.email}`} className="text-gray-700 hover:text-blue-700">{SALES_CONTACT.email}</a>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase mb-1">Phone</p>
              <a href={SALES_CONTACT.phoneHref} className="text-gray-700 hover:text-blue-700">{SALES_CONTACT.phone}</a>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
