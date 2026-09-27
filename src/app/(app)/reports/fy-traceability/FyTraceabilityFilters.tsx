'use client'

import Link from 'next/link'
import { MultiSelectFilter, type MultiSelectOption } from '@/components/MultiSelectFilter'
import { MONTH_NAMES } from '@/lib/dateRange'

type Named = { id: string; name: string }
type ItemOption = { id: string; item_code: string; item_name: string; size_label: string | null }

const BASE_PATH = '/reports/fy-traceability'
const SELECT_CLASS = 'rounded border border-gray-300 px-2 py-1.5 text-[0.9375rem] focus:border-blue-500 focus:outline-none'
const LABEL_CLASS = 'block text-[0.6875rem] font-medium text-gray-500 mb-1 uppercase'

/**
 * Filter bar for the FY Purchase & Sales Traceability report — a plain GET
 * form, so every selection lands in the URL. Month and year are always set:
 * the selected month's last day is the report's cutoff.
 */
export function FyTraceabilityFilters({
  month,
  year,
  yearOptions,
  companies,
  warehouses,
  suppliers,
  items,
  selected,
  showJobWork,
  companyLocked = false,
  warehouseLocked = false,
}: {
  month: number
  year: number
  yearOptions: number[]
  companies: Named[]
  warehouses: Named[]
  suppliers: Named[]
  items: ItemOption[]
  selected: { companyIds: string[]; warehouseIds: string[]; supplierIds: string[]; itemMasterIds: string[] }
  showJobWork: boolean
  companyLocked?: boolean
  warehouseLocked?: boolean
}) {
  const toOptions = (rows: Named[]): MultiSelectOption[] => rows.map((r) => ({ value: r.id, label: r.name }))
  const itemOptions: MultiSelectOption[] = items.map((i) => ({
    value: i.id,
    label: `${i.item_code} — ${i.item_name}`,
    sublabel: i.size_label ?? undefined,
  }))

  const hasFilters =
    selected.companyIds.length > 0 ||
    selected.warehouseIds.length > 0 ||
    selected.supplierIds.length > 0 ||
    selected.itemMasterIds.length > 0 ||
    !showJobWork

  return (
    <form className="rounded-xl border bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={LABEL_CLASS}>Month / Year</label>
          <div className="flex gap-2">
            <select name="month" aria-label="Month" defaultValue={String(month)} className={SELECT_CLASS}>
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>{name}</option>
              ))}
            </select>
            <select name="year" aria-label="Year" defaultValue={String(year)} className={SELECT_CLASS}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {companyLocked ? (
          <div>
            <label className={LABEL_CLASS}>Company</label>
            <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[0.9375rem] text-gray-600">
              {companies[0]?.name ?? '—'} <span className="text-xs text-gray-400">(your assigned company)</span>
            </p>
          </div>
        ) : (
          <MultiSelectFilter name="company" label="Company" options={toOptions(companies)} selected={selected.companyIds} placeholder="All companies" />
        )}

        {warehouseLocked ? (
          <div>
            <label className={LABEL_CLASS}>Warehouse</label>
            <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[0.9375rem] text-gray-600">
              {warehouses[0]?.name ?? '—'} <span className="text-xs text-gray-400">(your assigned warehouse)</span>
            </p>
          </div>
        ) : (
          <MultiSelectFilter name="warehouse" label="Warehouse" options={toOptions(warehouses)} selected={selected.warehouseIds} placeholder="All warehouses" />
        )}

        <MultiSelectFilter name="seller" label="Seller" options={toOptions(suppliers)} selected={selected.supplierIds} placeholder="All sellers" />
        <MultiSelectFilter name="item" label="Item" options={itemOptions} selected={selected.itemMasterIds} placeholder="All items" />

        <label className="flex items-center gap-2 pb-2 text-[0.9375rem] text-gray-700">
          {/* Unchecked boxes submit nothing, so the "off" state is the explicit jw=0. */}
          <input type="hidden" name="jw" value="0" />
          <input
            type="checkbox"
            name="jw"
            value="1"
            defaultChecked={showJobWork}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Show job work movements
        </label>

        <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-[0.9375rem] font-medium text-white hover:bg-blue-700">
          Apply
        </button>
        {hasFilters && (
          <Link href={`${BASE_PATH}?month=${month}&year=${year}`} className="pb-1.5 text-[0.9375rem] text-gray-500 hover:underline">
            Clear
          </Link>
        )}
      </div>
    </form>
  )
}
