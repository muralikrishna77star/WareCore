// The customer's own start page (saisteels.warecore.space): their name and a
// way to sign in, with pictures only when some are listed.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CustomerHome from '@/components/CustomerHome'
import { customerHomeImages } from '@/lib/tenancy/customerHome'
import { DEFAULT_LOGO_URL, type Brand } from '@/lib/tenancy/brandShared'

const brand: Brand = {
  displayName: 'Sai Steels',
  isCustomer: true,
  logoUrl: DEFAULT_LOGO_URL,
  color: null,
  googleSignIn: false,
}

const render = (images: Parameters<typeof CustomerHome>[0]['images']) =>
  renderToStaticMarkup(createElement(CustomerHome, { brand, images }))

describe('customer start page', () => {
  it('shows the company name and sign-in, and nothing of the WareCore sales site', () => {
    const html = render([])
    expect(html).toContain('<h1')
    expect(html).toContain('Sai Steels')
    expect(html).toContain('href="/login"')
    expect(html).not.toContain('Product Tour')
    expect(html).not.toContain('<figure')
  })

  it('shows listed pictures, first one large', () => {
    const html = render([
      { src: '/assets/customers/saisteels/yard.jpg', alt: 'Yard', caption: 'Our yard' },
      { src: '/assets/customers/saisteels/coils.jpg', alt: 'Coils' },
    ])
    expect(html.match(/<figure/g)).toHaveLength(2)
    expect(html).toContain('src="/assets/customers/saisteels/yard.jpg"')
    expect(html).toContain('Our yard')
    expect(html).toContain('aspect-[16/7]')
  })

  it('Sai Steels has no pictures yet; unknown customers get none', () => {
    expect(customerHomeImages('saisteels')).toEqual([])
    expect(customerHomeImages('nobody')).toEqual([])
  })
})
