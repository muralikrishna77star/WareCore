import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { parseWorkbook } from '@/lib/purchaseImport/parseWorkbook'
import { resolveImport } from '@/lib/purchaseImport/resolve'
import { fetchMasterDataSnapshot } from '@/lib/purchaseImport/fetchSnapshot'
import { buildInsertScript } from '@/lib/purchaseImport/buildInsertScript'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])

// Re-parses and re-resolves the uploaded file from scratch — never trusts a
// client-held preview result, since master data or the bill/line-id
// sequences could have changed since the preview was shown. Refuses to
// write anything unless the whole file resolves clean (all-or-nothing).
export async function POST(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const { rows, errors: parseErrors } = await parseWorkbook(buffer)
    if (parseErrors.length) return NextResponse.json({ error: 'File has errors — nothing was imported.', errors: parseErrors }, { status: 400 })
    if (!rows.length) return NextResponse.json({ error: 'No data rows found in the file.' }, { status: 400 })

    const snapshot = await fetchMasterDataSnapshot()
    const { bills, errors } = resolveImport(rows, snapshot)
    if (errors.length || !bills.length) {
      return NextResponse.json({ error: 'File has errors — nothing was imported.', errors }, { status: 400 })
    }

    const billsWithIds = bills.map((b) => ({ ...b, id: randomUUID() }))
    const script = buildInsertScript(billsWithIds)
    await hasuraRunSql(script)

    return NextResponse.json({
      bills: billsWithIds.map((b) => ({
        id: b.id, billNumber: b.billNumber,
        companyLabel: b.companyLabel, warehouseLabel: b.warehouseLabel, supplierLabel: b.supplierLabel,
        billDate: b.billDate, lineCount: b.lines.length,
        totalQuantity: b.totalQuantity, totalAmount: b.totalAmount,
      })),
      totalBills: billsWithIds.length,
      totalLines: billsWithIds.reduce((s, b) => s + b.lines.length, 0),
      totalQuantity: Number(billsWithIds.reduce((s, b) => s + b.totalQuantity, 0).toFixed(3)),
      totalAmount: Number(billsWithIds.reduce((s, b) => s + b.totalAmount, 0).toFixed(2)),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import failed — nothing was committed.' }, { status: 500 })
  }
}
