// The Product Tour as signed-in customers see it (Help → Product Tour).
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TourDeck from '@/app/(website)/tour/TourDeck'
import { SALES_CONTACT, TOUR_SLIDES, customerTourSlides } from '@/lib/marketing/productTour'

describe('customer Product Tour', () => {
  it('drops the sales slide always, and the QR slides while tracking is off', () => {
    const on = customerTourSlides(true)
    const off = customerTourSlides(false)
    expect(on.some((s) => s.kind === 'contact')).toBe(false)
    expect(on).toHaveLength(TOUR_SLIDES.length - 1)
    expect(off.some((s) => 'image' in s && s.image.includes('/qr-'))).toBe(false)
    expect(off.length).toBeLessThan(on.length)
  })

  it('has no "Book a demo" and ends back at Help', () => {
    const html = renderToStaticMarkup(createElement(TourDeck, { slides: customerTourSlides(false), endHref: '/help', endLabel: 'Back to Help' }))
    expect(html).not.toContain('Book a demo')
    expect(html).not.toContain(SALES_CONTACT.email)
  })

  it('the public tour still offers a demo', () => {
    const html = renderToStaticMarkup(createElement(TourDeck, { slides: TOUR_SLIDES, contact: SALES_CONTACT }))
    expect(html).toContain('Book a demo')
    expect(html).toContain(SALES_CONTACT.email)
  })
})
