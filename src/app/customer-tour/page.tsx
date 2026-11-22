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
      <header className="border-b print:hidden">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo comes from the customer registry */}
            <img src={brand.logoUrl} alt="" className="h-9 max-w-[8rem] object-contain" />
            <span className="truncate text-lg font-bold text-gray-900">{brand.displayName}</span>
          </Link>
          <Link
            href="/login"
            className="inline-flex shrink-0 items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Staff Login
          </Link>
        </div>
      </header>
      <TourDeck slides={slides} endHref="/login" endLabel="Sign in" />
    </div>
  )
}
