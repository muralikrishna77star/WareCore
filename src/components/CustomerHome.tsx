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
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo comes from the customer registry */}
            <img src={brand.logoUrl} alt="" className="h-9 max-w-[8rem] object-contain" />
            <span className="truncate text-lg font-bold text-gray-900">{brand.displayName}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:gap-5">
            <Link href="/tour" className="text-sm font-medium text-blue-700 hover:text-blue-900">
              Product Tour
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Staff Login
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="bg-gradient-to-br from-blue-600 to-blue-800 px-4 py-20 text-white sm:py-28">
          <div className="mx-auto max-w-4xl text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo comes from the customer registry */}
            <img
              src={brand.logoUrl}
              alt={`${brand.displayName} logo`}
              className="mx-auto mb-8 h-20 max-w-[14rem] rounded-xl bg-white object-contain p-3 shadow-lg"
            />
            <h1 className="break-words text-4xl font-bold sm:text-6xl">{brand.displayName}</h1>
            <p className="mt-4 text-lg text-blue-100">Warehouse Management</p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-3 font-semibold text-blue-700 transition-colors hover:bg-blue-50"
              >
                Sign in <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/tour"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/60 px-8 py-3 font-semibold text-white transition-colors hover:bg-white/10"
              >
                <PlayCircle className="h-5 w-5" /> Product Tour
              </Link>
            </div>
          </div>
        </section>

        {lead && (
          <section className="px-4 py-14 sm:px-6">
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

      <footer className="border-t py-6">
        <p className="text-center text-sm text-gray-500">
          © {new Date().getFullYear()} {brand.displayName} · Runs on WareCore
        </p>
      </footer>
    </div>
  )
}

function Picture({ image, large }: { image: CustomerHomeImage; large?: boolean }) {
  return (
    <figure className="overflow-hidden rounded-xl border bg-gray-50 shadow-sm">
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
