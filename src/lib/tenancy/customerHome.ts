// Pictures on each customer's own start page (<slug>.warecore.space).
//
// To add pictures for a customer: put the files in
// public/assets/customers/<slug>/ (JPEG or WebP, about 1600 px wide) and list
// them below under that customer's slug. A customer with no pictures gets a
// page with just their name and the sign-in button — no empty boxes.
// These pictures are public: anyone who opens the address can see them.

export interface CustomerHomeImage {
  /** Path under public/, e.g. /assets/customers/saisteels/yard.jpg */
  src: string
  /** Short description for screen readers, e.g. "Coils stacked in the yard". */
  alt: string
  /** Optional line shown under the picture. */
  caption?: string
}

const IMAGES: Record<string, CustomerHomeImage[]> = {
  saisteels: [],
}

export function customerHomeImages(slug: string): CustomerHomeImage[] {
  return IMAGES[slug] ?? []
}
