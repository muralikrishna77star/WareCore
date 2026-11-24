import { NextRequest, NextResponse } from 'next/server'
import { runReconciliation } from '@/lib/dataIntegrity/engine'
import { purgeExpiredPositions } from '@/lib/tracking/floor'
import { isMultiTenant } from '@/lib/tenancy/config'
import { listActiveTenants } from '@/lib/tenancy/control'
import { runWithTenant } from '@/lib/tenancy/context'
import { todayInIndia } from '@/lib/dates'

// Invoked by Vercel Cron (see vercel.json) — Vercel automatically sends
// `Authorization: Bearer $CRON_SECRET` on cron-triggered requests once
// CRON_SECRET is set as a project env var, so this only needs to check that
// header matches, not run a full login flow. Runs server-side against the
// same Hasura connection the rest of the app uses — no session, no service
// account. See runReconciliation() for what it writes (only
// reconciliation_runs/reconciliation_exceptions bookkeeping rows, never
// stock_ledger or any other production table).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isMultiTenant()) {
    const result = await nightlyScan()
    return NextResponse.json(result, { status: 'error' in result || result.status === 'FAILED' ? 500 : 200 })
  }

  // One deployment, several customers: scan each customer's own database in
  // turn. One customer's failure never stops the others' scans.
  const results: Record<string, unknown> = {}
  let failed = false
  for (const t of await listActiveTenants()) {
    const result = await runWithTenant({ slug: t.slug, dbName: t.dbName }, nightlyScan)
    results[t.slug] = result
    if ('error' in result || result.status === 'FAILED') failed = true
  }
  return NextResponse.json({ customers: results }, { status: failed ? 500 : 200 })
}

async function nightlyScan() {
  // A separate step: a clean-up failure must never affect the reconciliation scan.
  await purgeExpiredPositions().catch((err) => {
    console.error('[tracking] GPS clean-up failed:', err instanceof Error ? err.message : err)
  })

  try {
    return await runReconciliation({
      runType: 'NIGHTLY_FULL',
      scopeType: 'FULL',
      companyId: null,
      fromDate: '2000-01-01',
      toDate: todayInIndia(),
      startedBy: null,
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Reconciliation run failed' }
  }
}
