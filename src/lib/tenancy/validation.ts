import type { FirstAdmin } from './provision'

/** Name and colour as typed in the owner console; undefined = not being changed. */
export function validateTenantFields(input: { displayName?: unknown; brandColor?: unknown }):
  { displayName?: string; brandColor?: string | null } | { error: string } {
  const out: { displayName?: string; brandColor?: string | null } = {}
  if (input.displayName !== undefined) {
    const name = String(input.displayName).replace(/\s+/g, ' ').trim()
    if (name.length < 1 || name.length > 80) return { error: 'Customer name must be 1–80 characters' }
    out.displayName = name
  }
  if (input.brandColor !== undefined) {
    if (input.brandColor === null || input.brandColor === '') out.brandColor = null
    else {
      const c = String(input.brandColor).trim().toLowerCase()
      if (!/^#[0-9a-f]{6}$/.test(c)) return { error: 'Colour must look like #1d4ed8' }
      out.brandColor = c
    }
  }
  return out
}

export function validateFirstAdmin(input: unknown): FirstAdmin | { error: string } {
  const a = (input ?? {}) as Record<string, unknown>
  const fullName = String(a.fullName ?? '').trim()
  const email = String(a.email ?? '').toLowerCase().trim()
  const password = String(a.password ?? '')
  if (!fullName) return { error: 'The first admin\'s name is required' }
  if (!email || email.length > 254 || /\s/.test(email)) return { error: 'The first admin\'s email or username is required' }
  if (password.length < 10) return { error: 'The first admin\'s password must be at least 10 characters' }
  return { fullName, email, password }
}

const SIGNATURES: [string, (b: Buffer) => boolean][] = [
  ['image/png', (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/webp', (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
]

export const MAX_LOGO_BYTES = 256 * 1024

/**
 * The image type from the file's own bytes, not its name or the browser's
 * label. SVG is refused on purpose: it can carry script.
 */
export function sniffLogo(bytes: Buffer): string | null {
  return SIGNATURES.find(([, test]) => test(bytes))?.[0] ?? null
}
