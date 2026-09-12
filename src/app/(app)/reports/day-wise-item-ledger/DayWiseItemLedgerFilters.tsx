'use client'

import Link from 'next/link'
import { MultiSelectFilter, type MultiSelectOption } from '@/components/MultiSelectFilter'
import { MonthYearFilter } from '@/components/MonthYearFilter'
import { ENTRY_TYPES, ENTRY_TYPE_META } from '@/lib/dayWiseItemLedger'
import type { DayWiseFilters } from '@/lib/dayWiseItemLedgerData'

type Named = { id: string; name: string }
type ItemOption = { id: string; item_code: string; item_name: string; size_label: string | null }
type SizeOption = { id: string; size_label: string }

const BASE_PATH = '/reports/day-wise-item-ledger'

/**
 * Filter bar for the Day-Wise Item Ledger.
 *
 * A plain GET form: every selection lands in the URL, so a filtered view is
 * shareable and the server reads it straight back out of searchParams.
 *
 * Supplier / Customer / Job Worker submit NAMES rather than ids on purpose —
 * those parties are resolved from the source document during enrichment, so
 * the name is the value the report actually has to match against.
 */
export function DayWiseItemLedgerFilters({
  fromDate,
  toDate,
  companies,
  warehouses,
  items,
  sizes,
  suppliers,
  customers,
  jobWorkers,
  selected,
  month = '',
  year = '',
  yearOptions = [],
  companyLocked = false,
  warehouseLocked = false,
}: {
  fromDate: string
  toDate: string
  companies: Named[]
  warehouses: Named[]
  items: ItemOption[]
  sizes: SizeOption[]
  suppliers: Named[]
  customers: Named[]
  jobWorkers: Named[]
  selected: DayWiseFilters
  month?: string
  year?: string
  yearOptions?: number[]
  companyLocked?: boolean
  warehouseLocked?: boolean
}) {
  const toOptions = (rows: Named[]): MultiSelectOption[] =>
    rows.map((r) => ({ value: r.id, label: r.name }))
  const toNameOptions = (rows: Named[]): MultiSelectOption[] =>
    rows.map((r) => ({ value: r.name, label: r.name }))

  const itemOptions: MultiSelectOption[] = items.map((i) => ({
    value: i.id,
    label: `${i.item_code} — ${i.item_name}`,
    sublabel: i.size_label ?? undefined,
  }))

  const sizeOptions: MultiSelectOption[] = sizes.map((s) => ({ value: s.id, label: s.size_label }))

  const typeOptions: MultiSelectOption[] = ENTRY_TYPES.map((t) => ({
    value: t,
    label: ENTRY_TYPE_META[t].label,
    group: ENTRY_TYPE_META[t].group,
  })).sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label))

  const hasFilters =
    selected.companyIds.length > 0 ||
    selected.warehouseIds.length > 0 ||
    selected.itemMasterIds.length > 0 ||
    selected.materialSizeIds.length > 0 ||
    selected.entryTypes.length > 0 ||
    selected.supplierIds.length > 0 ||
    selected.customerIds.length > 0 ||
    selected.jobWorkerIds.length > 0 ||
    selected.documentNumber.trim() !== '' ||
    selected.includeCancelled ||
    month !== '' ||
    year !== ''

  return (
    <form className="rounded-xl border bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase">Month / Year</label>
          <div className="flex gap-2">
            <MonthYearFilter month={month} year={year} yearOptions={yearOptions} />
          </div>
        </div>

        <div>
          <label className="block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase">From Date</label>
          <input
            type="date"
            name="from"
            defaultValue={fromDate}
            className="rounded border border-gray-300 px-2 py-1.5 text-[0.9375rem] focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase">To Date</label>
          <input
            type="date"
            name="to"
            defaultValue={toDate}
            className="rounded border border-gray-300 px-2 py-1.5 text-[0.9375rem] focus:border-blue-500 focus:outline-none"
          />
        </div>

        {companyLocked ? (
          <div>
            <label className="block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase">Company</label>
            <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[0.9375rem] text-gray-600">
              {companies[0]?.name ?? '—'} <span className="text-xs text-gray-400">(your assigned company)</span>
            </p>
          </div>
        ) : (
          <MultiSelectFilter
            name="company"
            label="Company"
            options={toOptions(companies)}
            selected={selected.companyIds}
            placeholder="All companies"
          />
        )}

        {warehouseLocked ? (
          <div>
            <label className="block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase">Warehouse</label>
            <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[0.9375rem] text-gray-600">
              {warehouses[0]?.name ?? '—'} <span className="text-xs text-gray-400">(your assigned warehouse)</span>
            </p>
          </div>
        ) : (
          <MultiSelectFilter
            name="warehouse"
            label="Warehouse"
            options={toOptions(warehouses)}
            selected={selected.warehouseIds}
            placeholder="All warehouses"
          />
        )}

        <MultiSelectFilter
          name="item"
          label="Item Code / Name"
          options={itemOptions}
          selected={selected.itemMasterIds}
          placeholder="All items"
        />

        <MultiSelectFilter
          name="size"
          label="Item Size"
          options={sizeOptions}
          selected={selected.materialSizeIds}
          placeholder="All sizes"
        />

        <MultiSelectFilter
          name="type"
          label="Transaction Type"
          options={typeOptions}
          selected={selected.entryTypes}
          placeholder="All types"
        />

        <MultiSelectFilter
          name="supplier"
          label="Supplier"
          options={toNameOptions(suppliers)}
          selected={selected.supplierIds}
          placeholder="All suppliers"
        />

        <MultiSelectFilter
          name="customer"
          label="Customer"
          options={toNameOptions(customers)}
          selected={selected.customerIds}
          placeholder="All customers"
        />

        <MultiSelectFilter
          name="jobworker"
          label="Job Worker"
          options={toNameOptions(jobWorkers)}
          selected={selected.jobWorkerIds}
          placeholder="All job workers"
        />

        <div>
          <label className="block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase">
            Document / Bill No.
          </label>
          <input
            type="text"
            name="doc"
            defaultValue={selected.documentNumber}
            placeholder="e.g. 1124-0482"
            className="w-48 rounded border border-gray-300 px-2 py-1.5 text-[0.9375rem] focus:border-blue-500 focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2 pb-2 text-[0.9375rem] text-gray-700">
          <input
            type="checkbox"
            name="cancelled"
            value="1"
            defaultChecked={selected.includeCancelled}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Include cancelled
        </label>

        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-1.5 text-[0.9375rem] font-medium text-white hover:bg-blue-700"
        >
          Apply
        </button>
        {hasFilters && (
          <Link href={BASE_PATH} className="pb-1.5 text-[0.9375rem] text-gray-500 hover:underline">
            Clear
          </Link>
        )}
      </div>
    </form>
  )
}
