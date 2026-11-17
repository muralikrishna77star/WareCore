import type { Metadata } from 'next'
import { TOUR_SLIDES, SALES_CONTACT } from '@/lib/marketing/productTour'
import TourDeck from './TourDeck'

export const metadata: Metadata = {
  title: 'Product Tour — WareCore',
  description:
    'A guided tour of WareCore: purchases, live stock, job work, vendor transfers, direct sales, reports and data integrity for steel traders and processors.',
}

export default function ProductTourPage() {
  return <TourDeck slides={TOUR_SLIDES} contact={SALES_CONTACT} />
}
