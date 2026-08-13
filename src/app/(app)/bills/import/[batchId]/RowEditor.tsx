'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import AutocompleteSelect from '@/components/AutocompleteSelect'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import {
  CREATE_COMPANY_MUTATION, CREATE_WAREHOUSE_MUTATION, CREATE_SUPPLIER_MUTATION,
  CREATE_MATERIAL_TYPE_MUTATION, CREATE_MATERIAL_SIZE_MUTATION,
} from '@/lib/hasura/queries'
import type { ParsedRow, RowError } from '@/lib/purchaseImport/types'
import type { RowResolutionResult } from '@/lib/purchaseImport/resolve'
import type { MasterData } from './masterData'

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

// Label + a "↻" refresh icon — same convention bills/new/page.tsx uses on
// its Material Type/Item/Size/Tax Rate column headers, so a master record
// added from another tab (or just created via the dialogs below) shows up
// here without a full page reload.
function FieldLabel({ text, onRefresh, refreshing }: { text: string; onRefresh: () => void; refreshing: boolean }) {
  return (
    <label className="block text-xs font-medium text-gray-500 mb-1">
      {text}
      <button type="button" onClick={onRefresh} title={`Refresh ${text.toLowerCase()}`} className="ml-1 text-gray-400 hover:text-blue-500 align-middle">
        {refreshing ? '…' : <RefreshCw className="h-3.5 w-3.5 inline" />}
      </button>
    </label>
  )
}

const inputClass = (hasError?: string) =>
  `block w-full rounded border px-3 py-2 text-sm focus:outline-none ${hasError ? 'border-red-400' : 'border-gray-300 focus:border-blue-500'}`

// Small "+ Add New" modal shell, matching bills/new/page.tsx's inline
// creation dialogs (fixed inset-0 overlay, white card, Cancel/Create footer).
function CreateDialog({ title, onCancel, onCreate, creating, children }: { title: string; onCancel: () => void; onCreate: () => void; creating: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {children}
        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={onCancel} className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={onCreate} disabled={creating} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Expanded per-field correction panel for one staging row. Every field
// saves independently (PATCH .../rows/[rowId] with just that field) so a
// reviewer fixing 3 things on a row doesn't lose partial progress if one
// save fails. Company/Warehouse/Supplier/Material Type/Size each also get
// a "+ Add New" option inside their dropdown (Tax Rate doesn't — matching
// bills/new/page.tsx's own manual-entry form, which has no inline tax-rate
// creation either) using the exact same fields/mutations that screen uses.
export default function RowEditor({
  batchId,
  row,
  masterData,
  onChanged,
  onRefreshMasterData,
}: {
  batchId: string
  row: StagingRow
  masterData: MasterData
  onChanged: () => void
  onRefreshMasterData: (type: keyof MasterData) => Promise<void>
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState<keyof MasterData | null>(null)

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

  const refresh = async (type: keyof MasterData) => {
    setRefreshing(type)
    try {
      await onRefreshMasterData(type)
    } finally {
      setRefreshing(null)
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

  // ── "+ Add New" dialog state — one set per master type ────────────────
  const [dialog, setDialog] = useState<'company' | 'warehouse' | 'supplier' | 'materialType' | 'size' | null>(null)
  const [creating, setCreating] = useState(false)
  const [dialogError, setDialogError] = useState('')

  const [newCoName, setNewCoName] = useState(''); const [newCoCode, setNewCoCode] = useState('')
  const [newCoShortName, setNewCoShortName] = useState(''); const [newCoGstin, setNewCoGstin] = useState('')

  const [newWhName, setNewWhName] = useState('')
  const [newWhCompanyId, setNewWhCompanyId] = useState(resolved?.companyId ?? '')

  const [newSpName, setNewSpName] = useState(''); const [newSpPhone, setNewSpPhone] = useState(''); const [newSpGstin, setNewSpGstin] = useState('')

  const [newMtCode, setNewMtCode] = useState(''); const [newMtDescription, setNewMtDescription] = useState(''); const [newMtUnit, setNewMtUnit] = useState('tons')

  const [newSzMaterialTypeId, setNewSzMaterialTypeId] = useState(resolved?.materialTypeId ?? '')
  const [newSzLabel, setNewSzLabel] = useState(''); const [newSzThickness, setNewSzThickness] = useState(''); const [newSzWidth, setNewSzWidth] = useState('')

  const closeDialog = () => { setDialog(null); setDialogError(''); setCreating(false) }

  const createCompany = async () => {
    if (!newCoName.trim() || !newCoCode.trim()) { setDialogError('Name and Code are required'); return }
    setCreating(true); setDialogError('')
    const { data, error: err } = await hasuraFetch<{ insert_companies_one: { id: string; name: string } }>(CREATE_COMPANY_MUTATION, {
      name: newCoName.trim(), code: newCoCode.trim().toUpperCase(), short_name: newCoShortName || null, gstin: newCoGstin || null,
    })
    setCreating(false)
    if (err) { setDialogError(err.message); return }
    const created = data?.insert_companies_one
    if (created) {
      await onRefreshMasterData('companies')
      await saveField('company', created.name)
      closeDialog(); setNewCoName(''); setNewCoCode(''); setNewCoShortName(''); setNewCoGstin('')
    }
  }

  const createWarehouse = async () => {
    if (!newWhName.trim()) { setDialogError('Warehouse name is required'); return }
    if (!newWhCompanyId) { setDialogError('Please select a company'); return }
    setCreating(true); setDialogError('')
    const { data, error: err } = await hasuraFetch<{ insert_warehouses_one: { id: string; name: string } }>(CREATE_WAREHOUSE_MUTATION, {
      name: newWhName.trim(), company_id: newWhCompanyId,
    })
    setCreating(false)
    if (err) { setDialogError(err.message); return }
    const created = data?.insert_warehouses_one
    if (created) {
      await onRefreshMasterData('warehouses')
      await saveField('warehouse', created.name)
      closeDialog(); setNewWhName('')
    }
  }

  const createSupplier = async () => {
    if (!newSpName.trim()) { setDialogError('Supplier name is required'); return }
    setCreating(true); setDialogError('')
    const { data, error: err } = await hasuraFetch<{ insert_suppliers_one: { id: string; name: string } }>(CREATE_SUPPLIER_MUTATION, {
      name: newSpName.trim(), phone: newSpPhone || null, gstin: newSpGstin || null,
    })
    setCreating(false)
    if (err) { setDialogError(err.message); return }
    const created = data?.insert_suppliers_one
    if (created) {
      await onRefreshMasterData('suppliers')
      await saveField('supplier', created.name)
      closeDialog(); setNewSpName(''); setNewSpPhone(''); setNewSpGstin('')
    }
  }

  const createMaterialType = async () => {
    const code = newMtCode.trim().toUpperCase()
    if (code.length < 1 || code.length > 5) { setDialogError('Code must be 1-5 characters'); return }
    if (!newMtDescription.trim()) { setDialogError('Description is required'); return }
    setCreating(true); setDialogError('')
    const { data, error: err } = await hasuraFetch<{ insert_material_types_one: { id: string; code: string } }>(CREATE_MATERIAL_TYPE_MUTATION, {
      code, description: newMtDescription.trim(), unit: newMtUnit,
    })
    setCreating(false)
    if (err) { setDialogError(err.message); return }
    const created = data?.insert_material_types_one
    if (created) {
      await onRefreshMasterData('materialTypes')
      await saveField('materialType', created.code)
      closeDialog(); setNewMtCode(''); setNewMtDescription(''); setNewMtUnit('tons')
    }
  }

  const createSize = async () => {
    if (!newSzMaterialTypeId || !newSzLabel.trim()) { setDialogError('Material Type and Size Label are required'); return }
    setCreating(true); setDialogError('')
    const { data, error: err } = await hasuraFetch<{ insert_material_sizes_one: { id: string; size_label: string } }>(CREATE_MATERIAL_SIZE_MUTATION, {
      material_type_id: newSzMaterialTypeId, size_label: newSzLabel.trim(),
      thickness: newSzThickness ? parseFloat(newSzThickness) : null, width: newSzWidth ? parseFloat(newSzWidth) : null,
    })
    setCreating(false)
    if (err) { setDialogError(err.message); return }
    const created = data?.insert_material_sizes_one
    if (created) {
      await onRefreshMasterData('materialSizes')
      await saveField('size', created.size_label)
      closeDialog(); setNewSzLabel(''); setNewSzThickness(''); setNewSzWidth('')
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 rounded-b-lg border-t bg-gray-50 p-4 sm:grid-cols-3">
      <div>
        <FieldLabel text="Company" onRefresh={() => refresh('companies')} refreshing={refreshing === 'companies'} />
        <AutocompleteSelect
          currentLabel={resolved?.companyLabel ?? d.company}
          options={masterData.companies.map((c) => ({ id: c.id, label: c.name, sublabel: c.code }))}
          onSelect={(o) => saveField('company', o.label)}
          onAddNew={() => setDialog('company')}
          addNewLabel="+ New Company"
          error={errorFor(row.validation_errors, 'Company')}
          disabled={saving === 'company'}
        />
      </div>
      <div>
        <FieldLabel text="Warehouse" onRefresh={() => refresh('warehouses')} refreshing={refreshing === 'warehouses'} />
        <AutocompleteSelect
          currentLabel={resolved?.warehouseLabel ?? d.warehouse}
          options={warehouseOptions}
          onSelect={(o) => saveField('warehouse', o.label)}
          onAddNew={() => { setNewWhCompanyId(resolved?.companyId ?? ''); setDialog('warehouse') }}
          addNewLabel="+ New Warehouse"
          error={errorFor(row.validation_errors, 'Warehouse')}
          disabled={saving === 'warehouse'}
        />
      </div>
      <div>
        <FieldLabel text="Supplier" onRefresh={() => refresh('suppliers')} refreshing={refreshing === 'suppliers'} />
        <AutocompleteSelect
          currentLabel={resolved?.supplierLabel ?? d.supplier}
          options={masterData.suppliers.map((s) => ({ id: s.id, label: s.name }))}
          onSelect={(o) => saveField('supplier', o.label)}
          onAddNew={() => setDialog('supplier')}
          addNewLabel="+ New Supplier"
          error={errorFor(row.validation_errors, 'Supplier')}
          disabled={saving === 'supplier'}
        />
      </div>

      <div>
        <FieldLabel text="Material Type" onRefresh={() => refresh('materialTypes')} refreshing={refreshing === 'materialTypes'} />
        <AutocompleteSelect
          currentLabel={resolved?.materialTypeLabel ?? d.materialType}
          options={masterData.materialTypes.map((m) => ({ id: m.id, label: m.description, sublabel: m.code }))}
          onSelect={(o) => saveField('materialType', o.label)}
          onAddNew={() => setDialog('materialType')}
          addNewLabel="+ New Material Type"
          error={errorFor(row.validation_errors, 'Material Type')}
          disabled={saving === 'materialType'}
        />
      </div>
      <div>
        <FieldLabel text="Size" onRefresh={() => refresh('materialSizes')} refreshing={refreshing === 'materialSizes'} />
        <AutocompleteSelect
          currentLabel={resolved?.sizeLabel ?? d.size}
          options={sizeOptions}
          onSelect={(o) => saveField('size', o.label)}
          onAddNew={() => { setNewSzMaterialTypeId(resolved?.materialTypeId ?? ''); setDialog('size') }}
          addNewLabel="+ New Size"
          error={errorFor(row.validation_errors, 'Size')}
          disabled={saving === 'size'}
        />
      </div>
      <div>
        <FieldLabel text="Tax Rate" onRefresh={() => refresh('taxRates')} refreshing={refreshing === 'taxRates'} />
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

      {dialog === 'company' && (
        <CreateDialog title="Create New Company" onCancel={closeDialog} onCreate={createCompany} creating={creating}>
          {dialogError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{dialogError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Company Name *</label>
              <input type="text" value={newCoName} onChange={(e) => setNewCoName(e.target.value)} autoFocus placeholder="e.g. ABC Steels Ltd" className={inputClass()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Code *</label>
              <input type="text" value={newCoCode} onChange={(e) => setNewCoCode(e.target.value.toUpperCase())} placeholder="e.g. ABC" className={`${inputClass()} font-mono uppercase`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Short Name</label>
              <input type="text" value={newCoShortName} onChange={(e) => setNewCoShortName(e.target.value)} placeholder="Optional" className={inputClass()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">GSTIN</label>
              <input type="text" value={newCoGstin} onChange={(e) => setNewCoGstin(e.target.value.toUpperCase())} placeholder="Optional" className={inputClass()} />
            </div>
          </div>
        </CreateDialog>
      )}

      {dialog === 'warehouse' && (
        <CreateDialog title="Create New Warehouse" onCancel={closeDialog} onCreate={createWarehouse} creating={creating}>
          {dialogError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{dialogError}</p>}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Warehouse Name *</label>
            <input type="text" value={newWhName} onChange={(e) => setNewWhName(e.target.value)} autoFocus placeholder="e.g. Main Warehouse" className={inputClass()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Company *</label>
            <select value={newWhCompanyId} onChange={(e) => setNewWhCompanyId(e.target.value)} className={inputClass()}>
              <option value="">— Select Company —</option>
              {masterData.companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
          </div>
        </CreateDialog>
      )}

      {dialog === 'supplier' && (
        <CreateDialog title="Create New Supplier" onCancel={closeDialog} onCreate={createSupplier} creating={creating}>
          {dialogError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{dialogError}</p>}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Supplier Name *</label>
            <input type="text" value={newSpName} onChange={(e) => setNewSpName(e.target.value)} autoFocus placeholder="e.g. Steel Supplies Co." className={inputClass()} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
              <input type="text" value={newSpPhone} onChange={(e) => setNewSpPhone(e.target.value)} placeholder="Optional" className={inputClass()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">GSTIN</label>
              <input type="text" value={newSpGstin} onChange={(e) => setNewSpGstin(e.target.value.toUpperCase())} placeholder="Optional" className={inputClass()} />
            </div>
          </div>
        </CreateDialog>
      )}

      {dialog === 'materialType' && (
        <CreateDialog title="Create New Material Type" onCancel={closeDialog} onCreate={createMaterialType} creating={creating}>
          {dialogError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{dialogError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Code * (1-5 chars)</label>
              <input type="text" value={newMtCode} maxLength={5} onChange={(e) => setNewMtCode(e.target.value.toUpperCase())} placeholder="e.g. GA" autoFocus className={`${inputClass()} font-mono uppercase`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Description *</label>
              <input type="text" value={newMtDescription} onChange={(e) => setNewMtDescription(e.target.value)} placeholder="e.g. GA Sheet, CR Coil" className={inputClass()} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
            <select value={newMtUnit} onChange={(e) => setNewMtUnit(e.target.value)} className={inputClass()}>
              <option value="tons">Tons</option>
              <option value="kg">Kilograms</option>
              <option value="units">Units</option>
              <option value="meters">Meters</option>
            </select>
          </div>
        </CreateDialog>
      )}

      {dialog === 'size' && (
        <CreateDialog title="Create New Size" onCancel={closeDialog} onCreate={createSize} creating={creating}>
          {dialogError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{dialogError}</p>}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Material Type *</label>
            <select value={newSzMaterialTypeId} onChange={(e) => setNewSzMaterialTypeId(e.target.value)} className={inputClass()}>
              <option value="">— Select —</option>
              {masterData.materialTypes.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.description}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Size Label *</label>
            <input type="text" value={newSzLabel} onChange={(e) => setNewSzLabel(e.target.value)} placeholder="e.g. 0.80x121" className={inputClass()} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Thickness</label>
              <input type="number" step="0.01" value={newSzThickness} onChange={(e) => setNewSzThickness(e.target.value)} placeholder="Optional" className={inputClass()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Width</label>
              <input type="number" step="0.01" value={newSzWidth} onChange={(e) => setNewSzWidth(e.target.value)} placeholder="Optional" className={inputClass()} />
            </div>
          </div>
        </CreateDialog>
      )}
    </div>
  )
}
