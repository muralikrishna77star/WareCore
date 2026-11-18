import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { loadTrackingActor, type TrackingActor } from './access'
import { isTrackingMasterEnabled, TRACKING_ROLES, type TrackingPermission } from './constants'
import { TrackingError } from './service'

interface Context<P> {
  request: NextRequest
  actor: TrackingActor
  params: P
}

/**
 * Wraps a tracking API route. With the whole-app switch off it answers Not
 * Found before reading the session or the database.
 */
export function trackingRoute<P = Record<string, never>>(
  permission: TrackingPermission,
  handler: (context: Context<P>) => Promise<unknown>,
) {
  return async (request: NextRequest, route: { params: Promise<P> }) => {
    if (!isTrackingMasterEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const session = await verifySessionCookie(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
      const actor = await loadTrackingActor(session)
      if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (!TRACKING_ROLES[permission].has(actor.role)) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }
      return NextResponse.json(await handler({ request, actor, params: await route.params }))
    } catch (err) {
      if (err instanceof TrackingError) return NextResponse.json({ error: err.message }, { status: err.status })
      const code = (err as { code?: string }).code
      if (code === 'WC001') return NextResponse.json({ error: (err as Error).message }, { status: 409 })
      if (code === 'WC002') return NextResponse.json({ error: (err as Error).message }, { status: 403 })
      console.error('[tracking]', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'Something went wrong. Nothing was changed.' }, { status: 500 })
    }
  }
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}
