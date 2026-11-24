import Link from 'next/link'
import { ArrowRight, PlayCircle } from 'lucide-react'
import type { Brand } from '@/lib/tenancy/brandShared'
import type { CustomerHomeImage } from '@/lib/tenancy/customerHome'

// A customer's own start page (e.g. bsm.warecore.space): their name,
// logo and colour, a way to sign in, and their pictures when they have some.
// WareCore's sales website stays on www.warecore.space.
export default function CustomerHome({ brand, images }: { brand: Brand; images: CustomerHomeImage[] }) {
  const [lead, ...rest] = images
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/70 backdrop-blur-xl backdrop-saturate-150 shadow-[0_1px_0_rgb(255_255_255/0.8)_inset,0_6px_24px_-12px_rgb(30_64_175/0.25)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo comes from the customer registry */}
            <img src={brand.logoUrl} alt="" className="h-9 max-w-[8rem] object-contain" />
            <span className="truncate text-lg font-bold bg-gradient-to-r from-slate-900 via-blue-800 to-slate-900 bg-clip-text text-transparent">{brand.displayName}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:gap-5">
            <Link href="/tour" className="text-sm font-medium text-blue-700 hover:text-blue-900">
              Product Tour
            </Link>
            <Link
              href="/login"
              className="wc-shine wc-gloss inline-flex items-center rounded-lg bg-gradient-to-b from-blue-500 to-blue-700 px-4 py-2 text-sm font-medium text-white"
            >
              <span className="relative">Staff Login</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-blue-900 to-indigo-950 px-4 py-20 text-white sm:py-28">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="wc-float absolute -top-32 -left-24 h-[28rem] w-[28rem] rounded-full bg-sky-500/30 blur-3xl" />
            <div className="wc-float absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full bg-indigo-500/30 blur-3xl [animation-delay:-4s]" />
            <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgb(255_255_255)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.07] to-transparent" />
          </div>
          <div className="relative mx-auto max-w-4xl text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo comes from the customer registry */}
            <img
              src={brand.logoUrl}
              alt={`${brand.displayName} logo`}
              className="mx-auto mb-8 h-20 max-w-[14rem] rounded-2xl p-3 bg-gradient-to-b from-white to-blue-50 object-contain ring-1 ring-white/70 shadow-[inset_0_1px_0_white,0_12px_40px_-8px_rgb(56_189_248/0.6)]"
            />
            <h1 className="break-words text-4xl font-bold tracking-tight sm:text-6xl"><span className="wc-gloss-text">{brand.displayName}</span></h1>
            <p className="mt-4 text-lg text-blue-100">Warehouse Management</p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login"
                className="wc-shine wc-shine-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-white to-blue-50 px-8 py-3 font-semibold text-blue-700 shadow-[inset_0_1px_0_white,0_10px_30px_-8px_rgb(56_189_248/0.6)] transition-shadow hover:shadow-[inset_0_1px_0_white,0_14px_40px_-8px_rgb(56_189_248/0.8)]"
              >
                Sign in <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/tour"
                className="wc-shine inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-8 py-3 font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] backdrop-blur-md transition-colors hover:bg-white/20"
              >
                <PlayCircle className="h-5 w-5" /> Product Tour
              </Link>
            </div>
          </div>
        </section>

        {lead && (
          <section className="bg-gradient-to-b from-blue-50/70 to-white px-4 py-14 sm:px-6">
            <div className="mx-auto max-w-6xl space-y-6">
              <Picture image={lead} large />
              {rest.length > 0 && (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map((img) => <Picture key={img.src} image={img} />)}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="relative bg-gradient-to-b from-slate-50 to-blue-50/60 py-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-300 to-transparent" aria-hidden="true" />
        <p className="text-center text-sm text-gray-500">
          © {new Date().getFullYear()} {brand.displayName} · Runs on WareCore
        </p>
      </footer>
    </div>
  )
}

function Picture({ image, large }: { image: CustomerHomeImage; large?: boolean }) {
  return (
    <figure className="wc-glass overflow-hidden rounded-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element -- local file under public/ */}
      <img
        src={image.src}
        alt={image.alt}
        loading={large ? 'eager' : 'lazy'}
        className={`w-full object-cover ${large ? 'aspect-[16/7]' : 'aspect-[4/3]'}`}
      />
      {image.caption && <figcaption className="px-4 py-3 text-sm text-gray-600">{image.caption}</figcaption>}
    </figure>
  )
}
