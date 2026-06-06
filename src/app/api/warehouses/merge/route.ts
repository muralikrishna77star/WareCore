import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'

const ALLOWED_ROLES = new Set(['admin', 'developer'])

export async function POST(request: NextRequest) {
  try {
    const session = await verifySessionCookie(request)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { sourceId, targetId } = await request.json()
    if (!sourceId || !targetId) return NextResponse.json({ error: 'sourceId and targetId are required' }, { status: 400 })
    if (sourceId === targetId) return NextResponse.json({ error: 'Cannot merge a warehouse into itself' }, { status: 400 })

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRe.test(sourceId) || !uuidRe.test(targetId))
      return NextResponse.json({ error: 'Invalid warehouse IDs' }, { status: 400 })

    // Atomically reassign all references from source → target, then delete source
    const sql = `
      BEGIN;

      UPDATE purchase_bills
        SET warehouse_id = '${targetId}'
        WHERE warehouse_id = '${sourceId}';

      UPDATE dispatch_orders
        SET warehouse_id = '${targetId}'
        WHERE warehouse_id = '${sourceId}';

      UPDATE stock_ledger
        SET warehouse_id = '${targetId}'
        WHERE warehouse_id = '${sourceId}';

      UPDATE transfers
        SET from_warehouse_id = '${targetId}'
        WHERE from_warehouse_id = '${sourceId}';

      UPDATE transfers
        SET to_warehouse_id = '${targetId}'
        WHERE to_warehouse_id = '${sourceId}';

      UPDATE job_work_orders
        SET warehouse_id = '${targetId}'
        WHERE warehouse_id = '${sourceId}';

      UPDATE user_profiles
        SET warehouse_id = '${targetId}'
        WHERE warehouse_id = '${sourceId}';

      DELETE FROM warehouses WHERE id = '${sourceId}';

      COMMIT;

      SELECT 'ok' AS result;
    `

    await hasuraRunSql(sql)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Merge failed'
    console.error('[warehouse-merge]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
