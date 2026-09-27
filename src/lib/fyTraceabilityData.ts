/**
 * Data loading for the FY Purchase & Sales Traceability report. All
 * classification and arithmetic lives in ./fyTraceability.ts; this file only
 * reads rows.
 *
 * hasuraRunSql runs with the Hasura admin secret, so every value spliced into
 * SQL below is validated first: ids must be UUIDs, dates must be YYYY-MM-DD.
 */

import { hasuraRunSql } from '@/lib/hasura/server'
import {
  buildFyTraceability,
  type FyTraceabilityReport,
  type TraceMovement,
  type TracePurchaseLine,
  type UnlinkedSale,
} from '@/lib/fyTraceability'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface FyTraceabilityFilters {
  fyStart: string
  cutoff: string
  companyIds: string[]
  warehouseIds: string[]
  supplierIds: string[]
  itemMasterIds: string[]
}

const uuidList = (ids: string[]) => ids.filter((id) => UUID_RE.test(id)).map((id) => `'${id}'::uuid`).join(',')

const rowsOf = (res: { result?: string[][] }) => res.result?.slice(1) ?? []
const num = (v: string | null | undefined) => (v == null || v === 'NULL' ? 0 : Number(v))
const str = (v: string | null | undefined) => (v == null || v === 'NULL' ? '' : v)

/** The purchase lines in scope: every line billed on or before the cutoff that matches the filters. */
function linesCte(f: FyTraceabilityFilters): string {
  const where = [`p.purchase_line_id IS NOT NULL`, `b.status <> 'cancelled'`, `b.bill_date <= '${f.cutoff}'`]
  const companies = uuidList(f.companyIds)
  const warehouses = uuidList(f.warehouseIds)
  const suppliers = uuidList(f.supplierIds)
  const items = uuidList(f.itemMasterIds)
  if (companies) where.push(`b.company_id IN (${companies})`)
  if (warehouses) where.push(`b.warehouse_id IN (${warehouses})`)
  if (suppliers) where.push(`b.supplier_id IN (${suppliers})`)
  if (items) where.push(`p.item_master_id IN (${items})`)
  return `
    lines AS (
      SELECT p.*, b.bill_number, b.bill_date, b.supplier_id, b.company_id AS bill_company_id, b.warehouse_id AS bill_warehouse_id
      FROM purchase_bill_items p
      JOIN purchase_bills b ON b.id = p.bill_id
      WHERE ${where.join(' AND ')}
    )`
}

export async function loadFyTraceability(f: FyTraceabilityFilters): Promise<FyTraceabilityReport> {
  if (!DATE_RE.test(f.fyStart) || !DATE_RE.test(f.cutoff)) throw new Error('Invalid report period')
  const cte = linesCte(f)

  const [linesRes, movementsRes, unlinkedRes] = await Promise.all([
    hasuraRunSql(`
      WITH ${cte}
      SELECT l.purchase_line_id, COALESCE(l.bill_number, ''), l.bill_date::text,
             COALESCE(s.name, ''), COALESCE(c.name, ''), COALESCE(w.name, ''),
             im.item_code,
             COALESCE(NULLIF(l.item_name, ''), im.item_name, mt.description, ''),
             COALESCE(ms.size_label, l.size_label, ''),
             COALESCE(NULLIF(l.unit, ''), mt.unit, 'MT'),
             l.quantity::text, COALESCE(l.rate, 0)::text,
             COALESCE(l.taxable_value, l.amount, l.quantity * l.rate, 0)::text,
             COALESCE(l.total_with_tax, l.taxable_value, l.amount, 0)::text,
             COALESCE(l.cgst_rate + l.sgst_rate, tr.cgst_rate + tr.sgst_rate)::text
      FROM lines l
      LEFT JOIN suppliers s ON s.id = l.supplier_id
      LEFT JOIN companies c ON c.id = l.bill_company_id
      LEFT JOIN warehouses w ON w.id = l.bill_warehouse_id
      LEFT JOIN item_master im ON im.id = l.item_master_id
      LEFT JOIN material_types mt ON mt.id = l.material_type_id
      LEFT JOIN material_sizes ms ON ms.id = l.material_size_id
      LEFT JOIN tax_rates tr ON tr.id = l.tax_rate_id`),

    // Every ledger row of those lines up to the cutoff, in the order Purchase
    // Line Movements reads them. A sale's value comes from its dispatch line
    // and is apportioned by quantity when one dispatch line posted several
    // ledger rows.
    hasuraRunSql(`
      WITH ${cte},
      sale_value AS (
        SELECT di.dispatch_order_id, di.purchase_line_id,
               SUM(COALESCE(di.taxable_value, di.amount, 0)) AS value,
               SUM(COALESCE(di.total_with_tax, 0) - COALESCE(di.taxable_value, di.amount, 0)) AS gst
        FROM dispatch_items di
        WHERE di.purchase_line_id IN (SELECT purchase_line_id FROM lines)
        GROUP BY 1, 2
      ),
      sale_qty AS (
        SELECT reference_id, purchase_line_id, SUM(quantity) AS qty
        FROM stock_ledger
        WHERE entry_type = 'SALE_OUT' AND purchase_line_id IN (SELECT purchase_line_id FROM lines)
        GROUP BY 1, 2
      )
      SELECT sl.id::text, sl.purchase_line_id, sl.entry_type, sl.quantity::text, sl.entry_date::text,
             sl.created_at::text, sl.reference_number, sl.reference_type, sl.reference_id::text, sl.notes,
             COALESCE(v.vendor_delta, 0)::text,
             vs.name AS vendor_name,
             cu.name AS customer_name,
             CASE WHEN sl.entry_type = 'SALE_OUT' AND sq.qty <> 0 THEN (sv.value * sl.quantity / sq.qty)::text END,
             CASE WHEN sl.entry_type = 'SALE_OUT' AND sq.qty <> 0 THEN (sv.gst * sl.quantity / sq.qty)::text END,
             TRIM(BOTH ' ' FROM COALESCE(oi.item_name, '') || ' ' || COALESCE(ms.size_label, sl.size_label, '')),
             co.name, wh.name
      FROM stock_ledger sl
      LEFT JOIN vw_job_work_vendor_movements v ON v.id = sl.id
      LEFT JOIN job_work_orders jwo ON sl.reference_type = 'job_work' AND jwo.id = sl.reference_id
      LEFT JOIN suppliers vs ON vs.id = jwo.vendor_id
      LEFT JOIN dispatch_orders d ON sl.reference_type = 'dispatch' AND d.id = sl.reference_id
      LEFT JOIN customers cu ON cu.id = d.customer_id
      LEFT JOIN sale_value sv ON sv.dispatch_order_id = sl.reference_id AND sv.purchase_line_id = sl.purchase_line_id
      LEFT JOIN sale_qty sq ON sq.reference_id = sl.reference_id AND sq.purchase_line_id = sl.purchase_line_id
      LEFT JOIN material_sizes ms ON ms.id = sl.material_size_id
      LEFT JOIN companies co ON co.id = sl.company_id
      LEFT JOIN warehouses wh ON wh.id = sl.warehouse_id
      LEFT JOIN LATERAL (
        SELECT im.item_name FROM item_master im
        WHERE sl.entry_type = 'JOB_WORK_OUTPUT_IN'
          AND im.material_type_id = sl.material_type_id
          AND im.material_size_id IS NOT DISTINCT FROM sl.material_size_id
        ORDER BY im.item_code LIMIT 1
      ) oi ON true
      WHERE sl.purchase_line_id IN (SELECT purchase_line_id FROM lines)
        AND sl.entry_date <= '${f.cutoff}'
      ORDER BY sl.purchase_line_id, sl.entry_date, sl.created_at`),

    // Sales that name no purchase line can't reduce any line's balance; they
    // are listed on their own so sales totals still reconcile. They have no
    // seller, so a seller filter excludes them.
    f.supplierIds.length > 0
      ? Promise.resolve({ result: [] as string[][] })
      : hasuraRunSql(`
      SELECT d.dispatch_date::text, COALESCE(d.invoice_number, ''), COALESCE(cu.name, ''),
             COALESCE(NULLIF(di.item_name, ''), im.item_name, mt.description, ''),
             COALESCE(ms.size_label, di.size_label, ''),
             di.quantity::text,
             COALESCE(di.taxable_value, di.amount, 0)::text,
             (COALESCE(di.total_with_tax, 0) - COALESCE(di.taxable_value, di.amount, 0))::text
      FROM dispatch_items di
      JOIN dispatch_orders d ON d.id = di.dispatch_order_id
      LEFT JOIN customers cu ON cu.id = d.customer_id
      LEFT JOIN item_master im ON im.id = di.item_master_id
      LEFT JOIN material_types mt ON mt.id = di.material_type_id
      LEFT JOIN material_sizes ms ON ms.id = di.material_size_id
      WHERE di.purchase_line_id IS NULL
        AND d.status <> 'cancelled'
        AND d.dispatch_date BETWEEN '${f.fyStart}' AND '${f.cutoff}'
        ${uuidList(f.companyIds) ? `AND d.company_id IN (${uuidList(f.companyIds)})` : ''}
        ${uuidList(f.warehouseIds) ? `AND d.warehouse_id IN (${uuidList(f.warehouseIds)})` : ''}
        ${uuidList(f.itemMasterIds) ? `AND di.item_master_id IN (${uuidList(f.itemMasterIds)})` : ''}
      ORDER BY d.dispatch_date, d.invoice_number`),
  ])

  const lines: TracePurchaseLine[] = rowsOf(linesRes).map((r) => ({
    purchaseLineId: r[0],
    billNumber: str(r[1]),
    billDate: r[2],
    seller: str(r[3]),
    company: str(r[4]),
    warehouse: str(r[5]),
    itemCode: r[6] && r[6] !== 'NULL' ? r[6] : null,
    description: str(r[7]),
    size: str(r[8]),
    unit: str(r[9]) || 'MT',
    billedQty: num(r[10]),
    rate: num(r[11]),
    basic: num(r[12]),
    gst: num(r[13]) - num(r[12]),
    total: num(r[13]),
    gstRate: r[14] && r[14] !== 'NULL' ? Number(r[14]) : null,
  }))

  const movementsByLine = new Map<string, TraceMovement[]>()
  for (const r of rowsOf(movementsRes)) {
    const m: TraceMovement = {
      id: r[0],
      entry_type: r[2],
      quantity: num(r[3]),
      entry_date: r[4],
      created_at: str(r[5]) || null,
      reference_number: str(r[6]) || null,
      reference_type: str(r[7]) || null,
      reference_id: str(r[8]) || null,
      notes: str(r[9]) || null,
      vendorDelta: num(r[10]),
      vendorName: str(r[11]) || null,
      customerName: str(r[12]) || null,
      saleValue: r[13] && r[13] !== 'NULL' ? Number(r[13]) : null,
      saleGst: r[14] && r[14] !== 'NULL' ? Number(r[14]) : null,
      itemText: str(r[15]) || null,
      companyName: str(r[16]) || null,
      warehouses: r[17] && r[17] !== 'NULL' ? { name: r[17] } : null,
    }
    const list = movementsByLine.get(r[1])
    if (list) list.push(m)
    else movementsByLine.set(r[1], [m])
  }

  const unlinkedSales: UnlinkedSale[] = rowsOf(unlinkedRes).map((r) => ({
    date: r[0],
    reference: str(r[1]),
    customer: str(r[2]),
    description: str(r[3]),
    size: str(r[4]),
    qty: num(r[5]),
    saleValue: num(r[6]),
    saleGst: num(r[7]),
  }))

  return buildFyTraceability({ fyStart: f.fyStart, cutoff: f.cutoff, lines, movementsByLine, unlinkedSales })
}
