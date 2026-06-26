import { NextResponse } from 'next/server'

/** Lets client components detect the desktop (embedded Postgres) build at
 * runtime — LOCAL_MODE is only set by the launcher (scripts/desktop/start.mjs)
 * when it spawns the server process, so this can't be baked in at build time
 * via NEXT_PUBLIC_*, since the same build artifact serves both web and desktop. */
export async function GET() {
  return NextResponse.json({ isDesktop: process.env.LOCAL_MODE === 'true' })
}
