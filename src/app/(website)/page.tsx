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
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-blue-900 to-indigo-950 text-white py-24 sm:py-28 px-4">
        {/* Glow, a faint grid and a polished-steel sheen behind the hero text */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="wc-float absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full bg-sky-500/30 blur-3xl" />
          <div className="wc-float absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full bg-indigo-500/30 blur-3xl [animation-delay:-4s]" />
          <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgb(255_255_255)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.07] to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
        </div>
        <div className="relative max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-6xl font-bold mb-6 tracking-tight drop-shadow-[0_2px_24px_rgb(56_189_248/0.35)]">
            Steel Warehouse Management,<br />
            <span className="wc-gloss-text">Simplified</span>
          </h1>
          <p className="text-xl text-blue-100 mb-10 max-w-2xl mx-auto">
            Centralized inventory tracking, inter-company transfers, job work management, and dispatch — for steel processing businesses.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/tour" className="wc-shine wc-shine-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-white to-blue-50 text-blue-700 font-semibold px-8 py-3 shadow-[inset_0_1px_0_white,0_10px_30px_-8px_rgb(56_189_248/0.6)] hover:shadow-[inset_0_1px_0_white,0_14px_40px_-8px_rgb(56_189_248/0.8)] transition-shadow">
              <PlayCircle className="h-5 w-5" /> Take the Product Tour
            </Link>
            <Link href="/login" className="wc-shine inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/25 bg-white/10 backdrop-blur-md text-white font-semibold px-8 py-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] hover:bg-white/20 transition-colors">
              Staff Login <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="mt-4 text-sm text-blue-200">{TOUR_SLIDES.length} slides · about 3 minutes · no sign-up needed</p>
        </div>
      </section>

      {/* Product tour teaser */}
      <section className="py-16 px-4 bg-gradient-to-b from-blue-50/70 to-white">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">See it in action</p>
            <h2 className="text-3xl font-bold mb-4 bg-gradient-to-b from-slate-900 to-blue-800 bg-clip-text text-transparent">From purchase bill to vendor balance, in one guided tour</h2>
            <p className="text-gray-600 mb-6">
              Walk through the screens your team will use every day — live inventory, job work, vendor-to-vendor
              transfers, direct sales from vendors, stock statements and the data integrity control centre.
            </p>
            <Link href="/tour" className="wc-shine wc-gloss inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-blue-500 to-blue-700 text-white font-semibold px-6 py-3">
              <span className="relative inline-flex items-center gap-2">Go through the tour <ArrowRight className="h-4 w-4" /></span>
            </Link>
          </div>
          <Link href="/tour" className="wc-shine group relative block rounded-2xl p-[1px] bg-gradient-to-br from-sky-300 via-white to-indigo-300 shadow-[0_24px_60px_-20px_rgb(30_64_175/0.45)]" aria-label="Open the Product Tour">
            <span className="block overflow-hidden rounded-[15px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/tour/vendor-movements.jpg"
              alt="Vendorwise Stock Movement report from the WareCore demo"
              width={1440}
              height={900}
              className="w-full h-auto group-hover:scale-[1.02] transition-transform duration-300"
            />
            </span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-[1px] rounded-[15px] bg-gradient-to-br from-white/35 via-transparent to-transparent" />
          </Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative overflow-hidden py-20 px-4 bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-0 h-80 w-80 rounded-full bg-sky-300/30 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 -left-20 h-80 w-80 rounded-full bg-indigo-300/30 blur-3xl" />
        <div className="relative max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4 bg-gradient-to-b from-slate-900 to-blue-800 bg-clip-text text-transparent">Everything You Need</h2>
          <p className="text-center text-gray-500 mb-12 max-w-2xl mx-auto">
            Purpose-built for steel processing companies managing multiple entities and warehouses.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {(
              [
                { icon: ClipboardList, iconBg: 'from-sky-400 to-blue-600', title: 'Bill Entry', desc: 'Record inward purchase bills with line-item material details, quantities, and rates.' },
                { icon: Package, iconBg: 'from-emerald-400 to-green-600', title: 'Live Inventory', desc: 'Real-time stock levels per company, warehouse, material type, and size.' },
                { icon: ArrowLeftRight, iconBg: 'from-violet-400 to-indigo-600', title: 'Transfers', desc: 'Move material between sister companies and warehouses with full audit trail.' },
                { icon: Factory, iconBg: 'from-amber-400 to-orange-600', title: 'Job Work', desc: 'Track material sent for slitting, shearing, and other processing with return tracking.' },
                { icon: Truck, iconBg: 'from-rose-400 to-red-600', title: 'Dispatch', desc: 'Manage sales dispatches with vehicle tracking and auto stock deduction.' },
                { icon: TrendingUp, iconBg: 'from-teal-300 to-teal-600', title: 'Reports', desc: 'Comprehensive reports on stock, movements, and business performance.' },
                { icon: ShieldCheck, iconBg: 'from-fuchsia-400 to-purple-600', title: 'Role-based Access', desc: 'Fine-grained permissions: Admin, Company Manager, Warehouse Manager, and more.' },
                { icon: Smartphone, iconBg: 'from-cyan-300 to-cyan-600', title: 'Mobile Ready', desc: 'Works on phone and tablet. Install as an app on Android and iOS.' },
                { icon: Cloud, iconBg: 'from-sky-300 to-sky-600', title: 'Cloud Hosted', desc: 'Use it from any browser, with full backup and restore. A desktop edition can also run on a single PC.' },
              ] satisfies { icon: LucideIcon; iconBg: string; title: string; desc: string }[]
            ).map((f) => (
              <div key={f.title} className="wc-glass wc-shine rounded-2xl p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[inset_0_1px_0_white,0_20px_40px_-16px_rgb(30_64_175/0.35)]">
                <span className={`wc-gloss inline-flex h-11 w-11 items-center justify-center rounded-xl mb-3 bg-gradient-to-br ${f.iconBg}`}>
                  <f.icon className="relative h-5 w-5 text-white drop-shadow" strokeWidth={2} />
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
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-4 bg-gradient-to-b from-slate-900 to-blue-800 bg-clip-text text-transparent">Materials We Track</h2>
          <p className="text-center text-gray-500 mb-12">
            WareCore handles all common steel types used in fabrication and processing.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {['CR Coil', 'GI Sheet', 'GA Sheet', 'HR Coil', 'Painted Coil', 'Scrap', 'Channels', 'Custom Fabrication'].map((m) => (
              <div key={m} className="wc-shine rounded-xl border border-slate-300/80 bg-gradient-to-b from-white via-slate-100 to-slate-200 px-4 py-3 text-center shadow-[inset_0_1px_0_white,0_4px_12px_-6px_rgb(15_23_42/0.25)] transition hover:-translate-y-0.5">
                <p className="font-medium text-slate-800">{m}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-20 px-4 bg-gradient-to-b from-white to-blue-50">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4 bg-gradient-to-b from-slate-900 to-blue-800 bg-clip-text text-transparent">Get in Touch</h2>
          <p className="text-gray-500 mb-8">Have questions? Contact our team for a demo or support.</p>
          <div className="wc-glass rounded-2xl p-8 space-y-4 text-left">
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
