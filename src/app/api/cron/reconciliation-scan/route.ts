import { NextRequest, NextResponse } from 'next/server'
import { runReconciliation } from '@/lib/dataIntegrity/engine'

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

  try {
    const result = await runReconciliation({
      runType: 'NIGHTLY_FULL',
      scopeType: 'FULL',
      companyId: null,
      fromDate: '2000-01-01',
      toDate: new Date().toISOString().slice(0, 10),
      startedBy: null,
    })
    return NextResponse.json(result, { status: result.status === 'FAILED' ? 500 : 200 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Reconciliation run failed' }, { status: 500 })
  }
}
