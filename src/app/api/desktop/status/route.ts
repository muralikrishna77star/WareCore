import { NextResponse } from 'next/server'
import { GOOGLE_DESKTOP_CLIENT_ID } from '@/lib/env'

/** Lets client components detect the desktop (embedded Postgres) build at
 * runtime — LOCAL_MODE is only set by the launcher (scripts/desktop/start.mjs)
 * when it spawns the server process, so this can't be baked in at build time
 * via NEXT_PUBLIC_*, since the same build artifact serves both web and desktop.
 * googleOAuthAvailable is desktop-specific too — most distributed builds
 * don't carry a GOOGLE_DESKTOP_CLIENT_ID (see its comment in lib/env.ts), so
 * the login page needs to know at runtime whether this particular install
 * has one before showing the button. */
export async function GET() {
  return NextResponse.json({
    isDesktop: process.env.LOCAL_MODE === 'true',
    googleOAuthAvailable: !!GOOGLE_DESKTOP_CLIENT_ID,
  })
}
