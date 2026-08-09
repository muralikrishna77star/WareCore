import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { parseWorkbook } from '@/lib/purchaseImport/parseWorkbook'
import { resolveImport } from '@/lib/purchaseImport/resolve'
import { fetchMasterDataSnapshot } from '@/lib/purchaseImport/fetchSnapshot'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])

// Read-only: parses + resolves the uploaded file and returns what WOULD be
// imported (or the row errors blocking it) — never writes to the database.
// See /api/bills/import/commit for the write path, which re-parses and
// re-resolves from scratch rather than trusting this response.
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
    if (parseErrors.length) return NextResponse.json({ bills: [], errors: parseErrors })
    if (!rows.length) return NextResponse.json({ bills: [], errors: [{ rowNumber: null, message: 'No data rows found in the file.' }] })

    const snapshot = await fetchMasterDataSnapshot()
    const { bills, errors } = resolveImport(rows, snapshot)
    return NextResponse.json({ bills, errors })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to process file' }, { status: 500 })
  }
}
