import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { hasuraRunSql } from '@/lib/hasura/server'
import { CAN_VIEW, UUID_RE } from '@/lib/dataIntegrity/auth'
import { jobWorkReportHref, purchaseLineHref } from '@/lib/reportLinks'
import type { ExceptionReview, ReviewFinding } from '@/lib/dataIntegrity/review'

function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}
const qty = (v: string) => Number(v).toFixed(3)
const day = (v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

// Review & Fix for one open exception (migration 165). Read-only: it lists
// what the database's own proposal functions would change, so the page can
// offer a Fix button; the fix route re-derives everything before writing.
// Only REC-005 (negative company stock) has automatic review so far.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await verifySessionCookie(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_VIEW.has(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid exception id' }, { status: 400 })

  try {
    const [exception] = rowsToObjects(await hasuraRunSql(`
      SELECT e.id, e.status, e.company_id, e.material_type_id, e.material_size_id, r.rule_code, c.name AS company_name
      FROM reconciliation_exceptions e
      LEFT JOIN reconciliation_rules r ON r.id = e.rule_id
      LEFT JOIN companies c ON c.id = e.company_id
      WHERE e.id = '${id}'::uuid
    `))
    if (!exception) return NextResponse.json({ error: 'Exception not found' }, { status: 404 })

    const findings: ReviewFinding[] = []
    if (exception.rule_code !== 'REC-005' || !exception.company_id || exception.company_id === 'NULL') {
      findings.push({
        kind: 'none',
        title: 'No automatic review for this rule yet',
        detail: 'Open the full details to see the evidence and the rows involved.',
      })
      return NextResponse.json({ findings } satisfies ExceptionReview)
    }

    const company = `'${exception.company_id}'::uuid`
    const type = `'${exception.material_type_id}'::uuid`
    const size = exception.material_size_id && exception.material_size_id !== 'NULL' ? `'${exception.material_size_id}'::uuid` : 'NULL::uuid'

    const [transfers, outputs, noLine, negativeLines] = await Promise.all([
      hasuraRunSql(`
        SELECT x.purchase_line_id, fc.name AS from_name, tc.name AS to_name, x.quantity::text, x.entry_date::text,
               s.reference_number, s.entry_type
        FROM fn_rec005_intercompany_proposals(${type}, ${size}) x
        JOIN companies fc ON fc.id = x.from_company_id
        JOIN companies tc ON tc.id = x.to_company_id
        JOIN stock_ledger s ON s.id = x.src_ledger_id
        ORDER BY x.entry_date, x.purchase_line_id
      `),
      hasuraRunSql(`
        SELECT o.output_item_id, o.job_work_order_id, o.order_reference, o.source_job_line_id, o.purchase_line_id,
               o.output_item_code, o.output_size_label, o.input_item_code, o.input_size_label, o.quantity::text, o.received_date::text,
               (SELECT string_agg(sl.reference_number || ' (' || ABS(sl.quantity) || ')', ', ' ORDER BY sl.entry_date)
                  FROM stock_ledger sl
                 WHERE sl.company_id = ${company} AND sl.material_type_id = ${type} AND sl.material_size_id IS NOT DISTINCT FROM ${size}
                   AND sl.purchase_line_id = o.purchase_line_id AND sl.entry_type = 'SALE_OUT') AS sales
        FROM fn_rec005_output_item_proposals(${company}, ${type}, ${size}) o
      `),
      // Sales (or other outflows) in this scope with no purchase line at all —
      // e.g. sold under SUSPENSE: nothing says which stock they came from.
      hasuraRunSql(`
        SELECT sl.reference_type, sl.reference_id, sl.reference_number, sl.entry_date::text, sl.quantity::text,
               COALESCE(NULLIF(d.notes, ''), NULLIF(sl.notes, ''), '') AS notes, COALESCE(cu.name, '') AS customer
        FROM stock_ledger sl
        LEFT JOIN dispatch_orders d ON sl.reference_type = 'dispatch' AND d.id = sl.reference_id
        LEFT JOIN customers cu ON cu.id = d.customer_id
        WHERE sl.company_id = ${company} AND sl.material_type_id = ${type} AND sl.material_size_id IS NOT DISTINCT FROM ${size}
          AND sl.purchase_line_id IS NULL AND sl.quantity < 0
        ORDER BY sl.entry_date, sl.created_at
      `),
      hasuraRunSql(`
        SELECT sl.purchase_line_id, SUM(sl.quantity)::text AS net
        FROM stock_ledger sl
        WHERE sl.company_id = ${company} AND sl.material_type_id = ${type} AND sl.material_size_id IS NOT DISTINCT FROM ${size}
          AND sl.purchase_line_id IS NOT NULL
        GROUP BY sl.purchase_line_id
        HAVING SUM(sl.quantity) < -0.0005
        ORDER BY SUM(sl.quantity)
      `),
    ])

    const transferRows = rowsToObjects(transfers)
    if (transferRows.length) {
      const total = transferRows.reduce((s, t) => s + Number(t.quantity), 0)
      findings.push({
        kind: 'intercompany_transfer',
        title: `Stock moved between the companies with no transfer recorded — ${transferRows.length} transfer(s), ${total.toFixed(3)} MT`,
        detail: 'Each row below is a sale or job work dispatch that used stock another company was holding on that purchase line at the time. Recording the matching inter-company transfer (dated on that document, just before it) moves the stock to the company that used it — the same entries made by hand for earlier exceptions of this kind. Quantities sold and dispatched are not changed.',
        rowHeaders: ['Date', 'Purchase line', 'From → To', 'MT', 'Used by'],
        rows: transferRows.map((t) => [day(t.entry_date), t.purchase_line_id, `${t.from_name} → ${t.to_name}`, qty(t.quantity), t.reference_number]),
        links: [...new Set(transferRows.map((t) => t.purchase_line_id))].map((pl) => ({ label: `Purchase line ${pl}`, href: purchaseLineHref(pl) })),
        fix: { kind: 'intercompany_transfer' },
        fixLabel: `Record ${transferRows.length} transfer(s)`,
      })
    }

    for (const o of rowsToObjects(outputs)) {
      findings.push({
        kind: 'output_item',
        title: `${o.order_reference}: job line ${o.source_job_line_id} (${o.input_item_code} ${o.input_size_label}) came back recorded as ${o.output_item_code} ${o.output_size_label}`,
        detail: `${qty(o.quantity)} MT of Output Materials was received on ${day(o.received_date)} under ${o.output_size_label}, but purchase line ${o.purchase_line_id} has since been sold as ${o.input_size_label}${o.sales && o.sales !== 'NULL' ? ` (${o.sales})` : ''} — so ${o.input_size_label} runs short while ${o.output_size_label} shows stock it may not have. If the material came back as ${o.input_size_label}, fix the output below. If it really came back as ${o.output_size_label}, the sale invoices are what need correcting instead.`,
        links: [
          { label: `Edit ${o.order_reference}`, href: `/jobwork/${o.job_work_order_id}/edit` },
          { label: `Job Work Report`, href: jobWorkReportHref(o.job_work_order_id) },
          { label: `Purchase line ${o.purchase_line_id}`, href: purchaseLineHref(o.purchase_line_id) },
        ],
        fix: { kind: 'output_item', outputItemId: o.output_item_id },
        fixLabel: `Change output to ${o.input_item_code} ${o.input_size_label}`,
      })
    }

    const noLineRows = rowsToObjects(noLine)
    if (noLineRows.length) {
      const total = noLineRows.reduce((s, r) => s + Math.abs(Number(r.quantity)), 0)
      findings.push({
        kind: 'no_purchase_line',
        title: `${noLineRows.length} sale(s) with no stock behind them — ${total.toFixed(3)} MT`,
        detail: `These were recorded with no purchase line, so ${exception.company_name} never had this stock on record. The notes usually say what was really sold. Open each sale and pick the real item and purchase line (or the job work it was sold from); this exception clears once none are left. No automatic fix — only you know what each one was.`,
        rowHeaders: ['Date', 'Sale', 'Customer', 'MT', 'Note'],
        rows: noLineRows.map((r) => [day(r.entry_date), r.reference_number, r.customer, qty(String(Math.abs(Number(r.quantity)))), r.notes]),
        links: noLineRows
          .filter((r) => r.reference_type === 'dispatch' && r.reference_id && r.reference_id !== 'NULL')
          .map((r) => ({ label: `Edit sale ${r.reference_number}`, href: `/dispatch/${r.reference_id}/edit` })),
      })
    }

    // Anything still short that the patterns above don't explain.
    const explained = new Set([
      ...transferRows.map((t) => t.purchase_line_id),
      ...rowsToObjects(outputs).map((o) => o.purchase_line_id),
    ])
    const unexplained = rowsToObjects(negativeLines).filter((l) => !explained.has(l.purchase_line_id))
    if (unexplained.length) {
      findings.push({
        kind: 'negative_line',
        title: `${unexplained.length} purchase line(s) used more than was bought, with no known cause`,
        detail: 'More has been sold or sent out on these lines than was purchased, and it is not stock held by the other company or a mis-sized job work output. Check the purchase quantity and the sales on each line.',
        rowHeaders: ['Purchase line', 'Short by (MT)'],
        rows: unexplained.map((l) => [l.purchase_line_id, qty(String(-Number(l.net)))]),
        links: unexplained.map((l) => ({ label: `Purchase line ${l.purchase_line_id}`, href: purchaseLineHref(l.purchase_line_id) })),
      })
    }

    if (!findings.length) {
      findings.push({
        kind: 'none',
        title: 'No known cause matched',
        detail: 'Open the full details to see this item\'s movement history and find where it first went negative.',
      })
    }
    return NextResponse.json({ findings } satisfies ExceptionReview)
  } catch (err) {
    console.error('[data-integrity/review]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Review failed' }, { status: 500 })
  }
}
