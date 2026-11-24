import Link from 'next/link'
import TourDeck from '@/app/(website)/tour/TourDeck'
import { customerTourSlides } from '@/lib/marketing/productTour'
import { getBrand } from '@/lib/tenancy/brand'

export const metadata = { title: 'Product Tour · WareCore' }

// The Product Tour on a customer's own address for visitors who have not
// signed in (bsm.warecore.space/tour; the proxy rewrites /tour here). Same
// slides as Help → Product Tour, under the customer's name, ending at Sign in.
export default async function CustomerTourPage() {
  const brand = await getBrand()
  const slides = customerTourSlides(process.env.NEXT_PUBLIC_TRACKING_ENABLED === 'true')
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 border-b border-white/60 bg-white/70 backdrop-blur-xl backdrop-saturate-150 shadow-[0_1px_0_rgb(255_255_255/0.8)_inset,0_6px_24px_-12px_rgb(30_64_175/0.25)] print:hidden">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo comes from the customer registry */}
            <img src={brand.logoUrl} alt="" className="h-9 max-w-[8rem] object-contain" />
            <span className="truncate text-lg font-bold bg-gradient-to-r from-slate-900 via-blue-800 to-slate-900 bg-clip-text text-transparent">{brand.displayName}</span>
          </Link>
          <Link
            href="/login"
            className="wc-shine wc-gloss inline-flex items-center rounded-lg bg-gradient-to-b from-blue-500 to-blue-700 px-4 py-2 text-sm font-medium text-white shrink-0"
          >
            <span className="relative">Staff Login</span>
          </Link>
        </div>
      </header>
      <TourDeck slides={slides} endHref="/login" endLabel="Sign in" />
    </div>
  )
}
