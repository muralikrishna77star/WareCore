'use client'

import { useState } from 'react'
import AutocompleteSelect from '@/components/AutocompleteSelect'
import type { ParsedRow, RowError } from '@/lib/purchaseImport/types'
import type { RowResolutionResult } from '@/lib/purchaseImport/resolve'

interface MasterOptions {
  companies: { id: string; name: string; code: string }[]
  warehouses: { id: string; name: string; company_id: string }[]
  suppliers: { id: string; name: string }[]
  materialTypes: { id: string; code: string; description: string }[]
  materialSizes: { id: string; material_type_id: string; size_label: string }[]
  taxRates: { id: string; name: string }[]
}

export interface StagingRow {
  id: string
  row_number: number
  current_data: ParsedRow
  resolved_field_ids: RowResolutionResult['resolved'] | null
  validation_errors: RowError[]
  is_valid: boolean
  reviewed: boolean
}

function errorFor(errors: RowError[], column: string): string | undefined {
  return errors.find((e) => e.column === column)?.message
}

// Expanded per-field correction panel for one staging row. Every field
// saves independently (PATCH .../rows/[rowId] with just that field) so a
// reviewer fixing 3 things on a row doesn't lose partial progress if one
// save fails.
export default function RowEditor({
  batchId,
  row,
  masterData,
  onChanged,
}: {
  batchId: string
  row: StagingRow
  masterData: MasterOptions
  onChanged: () => void
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')

  const saveField = async (field: keyof ParsedRow, value: unknown) => {
    setSaving(field)
    setError('')
    try {
      const res = await fetch(`/api/bills/import/batches/${batchId}/rows/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [field]: value } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || `Server error (${res.status})`); return }
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(null)
    }
  }

  const d = row.current_data
  const resolved = row.resolved_field_ids
  const warehouseOptions = masterData.warehouses
    .filter((w) => !resolved?.companyId || w.company_id === resolved.companyId)
    .map((w) => ({ id: w.id, label: w.name }))
  const sizeOptions = masterData.materialSizes
    .filter((s) => !resolved?.materialTypeId || s.material_type_id === resolved.materialTypeId)
    .map((s) => ({ id: s.id, label: s.size_label }))

  return (
    <div className="grid grid-cols-1 gap-3 rounded-b-lg border-t bg-gray-50 p-4 sm:grid-cols-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Company</label>
        <AutocompleteSelect
          currentLabel={resolved?.companyLabel ?? d.company}
          options={masterData.companies.map((c) => ({ id: c.id, label: c.name, sublabel: c.code }))}
          onSelect={(o) => saveField('company', o.label)}
          error={errorFor(row.validation_errors, 'Company')}
          disabled={saving === 'company'}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse</label>
        <AutocompleteSelect
          currentLabel={resolved?.warehouseLabel ?? d.warehouse}
          options={warehouseOptions}
          onSelect={(o) => saveField('warehouse', o.label)}
          error={errorFor(row.validation_errors, 'Warehouse')}
          disabled={saving === 'warehouse'}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
        <AutocompleteSelect
          currentLabel={resolved?.supplierLabel ?? d.supplier}
          options={masterData.suppliers.map((s) => ({ id: s.id, label: s.name }))}
          onSelect={(o) => saveField('supplier', o.label)}
          error={errorFor(row.validation_errors, 'Supplier')}
          disabled={saving === 'supplier'}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Material Type</label>
        <AutocompleteSelect
          currentLabel={resolved?.materialTypeLabel ?? d.materialType}
          options={masterData.materialTypes.map((m) => ({ id: m.id, label: m.description, sublabel: m.code }))}
          onSelect={(o) => saveField('materialType', o.label)}
          error={errorFor(row.validation_errors, 'Material Type')}
          disabled={saving === 'materialType'}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Size</label>
        <AutocompleteSelect
          currentLabel={resolved?.sizeLabel ?? d.size}
          options={sizeOptions}
          onSelect={(o) => saveField('size', o.label)}
          error={errorFor(row.validation_errors, 'Size')}
          disabled={saving === 'size'}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Tax Rate</label>
        <AutocompleteSelect
          currentLabel={d.taxRate || null}
          options={masterData.taxRates.map((t) => ({ id: t.id, label: t.name }))}
          onSelect={(o) => saveField('taxRate', o.label)}
          error={errorFor(row.validation_errors, 'Tax Rate')}
          disabled={saving === 'taxRate'}
          placeholder="No tax"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Bill Date</label>
        <input
          type="date"
          defaultValue={d.billDate || undefined}
          onBlur={(e) => e.target.value !== d.billDate && saveField('billDate', e.target.value)}
          disabled={saving === 'billDate'}
          className={`block w-full rounded border px-2 py-1.5 text-sm focus:outline-none ${errorFor(row.validation_errors, 'Bill Date') ? 'border-red-400' : 'border-gray-300 focus:border-blue-500'}`}
        />
        {errorFor(row.validation_errors, 'Bill Date') && <p className="mt-0.5 text-xs text-red-600">{errorFor(row.validation_errors, 'Bill Date')}</p>}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Bill Ref (optional)</label>
        <input
          type="text"
          defaultValue={d.billRef}
          onBlur={(e) => e.target.value !== d.billRef && saveField('billRef', e.target.value)}
          disabled={saving === 'billRef'}
          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div />

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Quantity</label>
        <input
          type="number" step="any"
          defaultValue={d.quantity ?? ''}
          onBlur={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value)
            if (v !== d.quantity) saveField('quantity', v)
          }}
          disabled={saving === 'quantity'}
          className={`block w-full rounded border px-2 py-1.5 text-sm focus:outline-none ${errorFor(row.validation_errors, 'Quantity') ? 'border-red-400' : 'border-gray-300 focus:border-blue-500'}`}
        />
        {errorFor(row.validation_errors, 'Quantity') && <p className="mt-0.5 text-xs text-red-600">{errorFor(row.validation_errors, 'Quantity')}</p>}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Unit</label>
        <input
          type="text"
          defaultValue={d.unit}
          placeholder={resolved?.unit ?? undefined}
          onBlur={(e) => e.target.value !== d.unit && saveField('unit', e.target.value)}
          disabled={saving === 'unit'}
          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Rate</label>
        <input
          type="number" step="any"
          defaultValue={d.rate ?? ''}
          onBlur={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value)
            if (v !== d.rate) saveField('rate', v)
          }}
          disabled={saving === 'rate'}
          className={`block w-full rounded border px-2 py-1.5 text-sm focus:outline-none ${errorFor(row.validation_errors, 'Rate') ? 'border-red-400' : 'border-gray-300 focus:border-blue-500'}`}
        />
        {errorFor(row.validation_errors, 'Rate') && <p className="mt-0.5 text-xs text-red-600">{errorFor(row.validation_errors, 'Rate')}</p>}
      </div>

      <div className="sm:col-span-3">
        <label className="block text-xs font-medium text-gray-500 mb-1">Line Notes (optional)</label>
        <input
          type="text"
          defaultValue={d.lineNotes}
          onBlur={(e) => e.target.value !== d.lineNotes && saveField('lineNotes', e.target.value)}
          disabled={saving === 'lineNotes'}
          className="block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {row.validation_errors.filter((e) => !e.column).length > 0 && (
        <div className="sm:col-span-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {row.validation_errors.filter((e) => !e.column).map((e, i) => <p key={i}>{e.message}</p>)}
        </div>
      )}
      {error && <p className="sm:col-span-3 text-xs text-red-600">{error}</p>}
    </div>
  )
}
