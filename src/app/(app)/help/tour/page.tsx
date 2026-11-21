import TourDeck from '@/app/(website)/tour/TourDeck'
import { customerTourSlides } from '@/lib/marketing/productTour'

export const metadata = { title: 'Product Tour · WareCore' }

// The Product Tour for signed-in users of every customer: the same slides as
// www.warecore.space/tour without the sales slide, ending back at Help.
export default function HelpTourPage() {
  const slides = customerTourSlides(process.env.NEXT_PUBLIC_TRACKING_ENABLED === 'true')
  return <TourDeck slides={slides} endHref="/help" endLabel="Back to Help" />
}
