// Brand data shared by server and client code. No server imports here: client
// components (BrandProvider) import this file.

/** How the screens present the customer. Plain data: it's passed to client components. */
export interface Brand {
  /** The customer's name, or "WareCore" when there is no customer (single-customer mode, website, owner console). */
  displayName: string
  /** True when displayName is a customer's own name rather than WareCore's. */
  isCustomer: boolean
  logoUrl: string
  /** #rrggbb, or null for WareCore's own blue. */
  color: string | null
  /** Whether this customer's sign-in page offers Google sign-in. */
  googleSignIn: boolean
}

export const DEFAULT_LOGO_URL = '/assets/brand/logo-mark.svg'
export const DEFAULT_BRAND_COLOR = '#2563eb'

export const DEFAULT_BRAND: Brand = {
  displayName: 'WareCore',
  isCustomer: false,
  logoUrl: DEFAULT_LOGO_URL,
  color: null,
  googleSignIn: true,
}

/**
 * Re-colours the whole app from one colour. The screens use Tailwind's blue
 * classes for buttons, links and highlights, and Tailwind 4 draws each of
 * them from a --color-blue-* variable, so redefining the scale here changes
 * every screen without touching any of them. 600 is the customer's colour;
 * lighter and darker steps are mixed from it.
 */
export function brandCss(color: string | null): string {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return ''
  const mix = (pct: number, toward: 'white' | 'black') => `color-mix(in oklab, ${color} ${pct}%, ${toward})`
  const scale: Record<string, string> = {
    50: mix(7, 'white'), 100: mix(14, 'white'), 200: mix(28, 'white'), 300: mix(45, 'white'),
    400: mix(65, 'white'), 500: mix(85, 'white'), 600: color, 700: mix(82, 'black'),
    800: mix(66, 'black'), 900: mix(52, 'black'), 950: mix(36, 'black'),
  }
  return `:root{${Object.entries(scale).map(([k, v]) => `--color-blue-${k}:${v}`).join(';')}}`
}
