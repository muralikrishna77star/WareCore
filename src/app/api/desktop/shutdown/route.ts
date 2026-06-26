import { NextResponse } from 'next/server'

/** Desktop-only: fully stops this process. The launcher (scripts/desktop/
 * start.mjs) watches for the server process to exit and stops the embedded
 * Postgres in response, so this shuts down the whole local stack, not just
 * the browser window. */
export async function POST() {
  if (process.env.LOCAL_MODE !== 'true') {
    return NextResponse.json({ error: 'Only available in the desktop build' }, { status: 403 })
  }

  setTimeout(() => process.exit(0), 250)
  return NextResponse.json({ ok: true })
}
