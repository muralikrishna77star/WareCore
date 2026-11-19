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

      -- The surviving warehouse keeps its own QR tracking switch.
      DO $tracking$
      BEGIN
        IF to_regclass('public.tracking_units') IS NOT NULL THEN
          UPDATE tracking_units SET warehouse_id = '${targetId}' WHERE warehouse_id = '${sourceId}';
          UPDATE tracking_printers SET warehouse_id = '${targetId}' WHERE warehouse_id = '${sourceId}';
          DELETE FROM tracking_feature_flags WHERE warehouse_id = '${sourceId}';
        END IF;
        IF to_regclass('public.tracking_locations') IS NOT NULL THEN
          -- A code already used in the surviving warehouse gets a unique suffix.
          UPDATE tracking_locations s
             SET code = left(s.code, 25) || '-' || upper(substr(md5(s.id::text), 1, 6))
           WHERE s.warehouse_id = '${sourceId}'
             AND EXISTS (SELECT 1 FROM tracking_locations t WHERE t.warehouse_id = '${targetId}' AND t.code = s.code);
          UPDATE tracking_locations SET warehouse_id = '${targetId}' WHERE warehouse_id = '${sourceId}';
          UPDATE tracking_pickups SET warehouse_id = '${targetId}' WHERE warehouse_id = '${sourceId}';
          -- tracking_verifications is a permanent record of where stock was checked, so it stays as written.
        END IF;
        IF to_regclass('public.tracking_vendor_dispatches') IS NOT NULL THEN
          UPDATE tracking_vendor_dispatches SET warehouse_id = '${targetId}' WHERE warehouse_id = '${sourceId}';
          UPDATE tracking_output_receipts SET warehouse_id = '${targetId}' WHERE warehouse_id = '${sourceId}';
        END IF;
      END
      $tracking$;

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
