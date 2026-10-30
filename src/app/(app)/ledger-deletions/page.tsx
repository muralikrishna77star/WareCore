export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { hasuraRunSql } from '@/lib/hasura/server'
import { StatCard } from '@/components/StatCard'
import { LedgerDeletionsRows, type LedgerDeletionRow } from './LedgerDeletionsRows'

type Row = (string | null)[]
// run_sql returns SQL NULL as the text 'NULL'.
function rowsToObjects(result: { result: Row[] }): Record<string, string | null>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col as string, row[i] === 'NULL' ? null : row[i]])))
}

// Every row removed with Select → Delete on the Item Stock Ledger.
// delete_stock_ledger_rows() (migration 153) copies the full row into
// stock_ledger_deletions before deleting it; this is the read side of that
// archive. The item comes from the row's purchase line, the reference link
// only when the job work order still exists.
export default async function LedgerDeletionsPage() {
  const result = await hasuraRunSql(`
    SELECT d.id, d.stock_ledger_id, d.deleted_at, up.full_name AS deleted_by_name,
           r.entry_type, r.quantity, r.size_label, r.entry_date, r.purchase_line_id,
           r.reference_type, r.reference_id, r.reference_number, r.notes, r.created_at,
           mt.code AS material_code, c.name AS company_name, w.name AS warehouse_name,
           im.id AS item_master_id, im.item_code, im.item_name,
           (jwo.id IS NOT NULL) AS reference_exists
    FROM stock_ledger_deletions d
    CROSS JOIN LATERAL jsonb_to_record(d.ledger_row) AS r(
      entry_type text, quantity numeric, size_label text, entry_date date, purchase_line_id text,
      reference_type text, reference_id uuid, reference_number text, notes text, created_at timestamptz,
      material_type_id uuid, company_id uuid, warehouse_id uuid)
    LEFT JOIN user_profiles up ON up.id = d.deleted_by
    LEFT JOIN material_types mt ON mt.id = r.material_type_id
    LEFT JOIN companies c ON c.id = r.company_id
    LEFT JOIN warehouses w ON w.id = r.warehouse_id
    LEFT JOIN LATERAL (
      SELECT pbi.item_master_id FROM purchase_bill_items pbi
      WHERE pbi.purchase_line_id = r.purchase_line_id AND pbi.item_master_id IS NOT NULL
      LIMIT 1
    ) pl ON true
    LEFT JOIN item_master im ON im.id = pl.item_master_id
    LEFT JOIN job_work_orders jwo ON r.reference_type = 'job_work' AND jwo.id = r.reference_id
    ORDER BY d.deleted_at DESC, r.reference_number, r.purchase_line_id, r.entry_type, r.quantity
    LIMIT 5000
  `)
  const records: LedgerDeletionRow[] = rowsToObjects(result).map((r) => ({
    id: r.id as string,
    stockLedgerId: r.stock_ledger_id as string,
    deletedAt: r.deleted_at as string,
    deletedBy: r.deleted_by_name,
    entryType: r.entry_type ?? '',
    quantity: Number(r.quantity ?? 0),
    sizeLabel: r.size_label,
    entryDate: r.entry_date,
    purchaseLineId: r.purchase_line_id,
    referenceType: r.reference_type,
    referenceId: r.reference_exists === 't' ? r.reference_id : null,
    referenceNumber: r.reference_number,
    notes: r.notes,
    createdAt: r.created_at,
    materialCode: r.material_code,
    companyName: r.company_name,
    warehouseName: r.warehouse_name,
    itemMasterId: r.item_master_id,
    itemCode: r.item_code,
    itemName: r.item_name,
  }))
  const deleteActions = new Set(records.map((r) => r.deletedAt)).size

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deleted Ledger Rows</h1>
          <p className="mt-1 text-sm text-gray-500">
            Stock ledger rows removed with Delete on the Item Stock Ledger — who removed them, when, and the full row as it was
          </p>
        </div>
        <Link href="/reports/item-ledger" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Item Stock Ledger
        </Link>
      </div>

      {records.length === 0 ? (
        <div className="rounded-xl border bg-white p-12 text-center">
          <Trash2 className="mx-auto h-10 w-10 mb-3 text-gray-400" />
          <p className="text-gray-500">No ledger rows have been deleted.</p>
          <p className="text-sm text-gray-400 mt-1">Rows deleted from the Item Stock Ledger appear here.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <StatCard icon={Trash2} iconBg="bg-red-100" iconColor="text-red-600"
              value={String(records.length)} label={records.length === 1 ? 'deleted row' : 'deleted rows'} />
            <StatCard icon={Trash2} iconBg="bg-gray-100" iconColor="text-gray-600"
              value={String(deleteActions)} label={deleteActions === 1 ? 'delete action' : 'delete actions'} />
          </div>
          <LedgerDeletionsRows records={records} />
        </>
      )}
    </div>
  )
}
