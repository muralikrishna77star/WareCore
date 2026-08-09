import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { fetchMasterDataSnapshot } from '@/lib/purchaseImport/fetchSnapshot'
import { buildTemplateWorkbook } from '@/lib/purchaseImport/buildTemplateWorkbook'

const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])

export async function GET(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const snapshot = await fetchMasterDataSnapshot()
  const workbook = buildTemplateWorkbook(snapshot)
  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="warecore-purchase-import-template.xlsx"',
    },
  })
}
