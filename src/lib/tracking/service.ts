// Every tracking read and write. Writes go only to the tracking_ tables: no
// function here touches a purchase, job work, sale, transfer or ledger table
// except to read it. All values are passed as query parameters.
import { getPool } from '@/lib/localdb/pool'
import { actorCanAccess, actorScopeSql, type TrackingActor } from './access'
import {
  LIFECYCLE_LABELS, MAX_BUNDLES, QR_REFERENCE_RE, STOCK_TRACKING_ID_RE, TEST_LABEL_CODE, TRACKING_ROLES, UUID_RE,
  type EligibleLine, type LifecycleStatus, type PrintStatus, type TrackingPermission, type TrackingPrinter, type TrackingUnit,
} from './constants'
import { buildLabelZpl, labelFieldsForUnit, testLabelFields, type LabelFields, type LabelPrinterSetup, type LabelTemplate, type UnitForLabel } from './zpl'
import type { LabelLayout, PrintableLabel } from './htmlLabel'

export class TrackingError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message)
  }
}

export type Row = Record<string, string>

export async function query(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await (await getPool()).query(sql, params)).rows as Row[]
}

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new TrackingError(`${label} is not valid`)
  return value
}

export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, '\\$&')}%`
}

/** Route permissions are the first gate. Service functions check again, so no caller can skip it. */
export function assertCan(actor: TrackingActor, permission: TrackingPermission): void {
  if (!TRACKING_ROLES[permission].has(actor.role)) throw new TrackingError('Insufficient permissions', 403)
}

export const UNIT_COLUMNS = `u.id::text, u.stock_tracking_id, u.qr_reference, u.company_id::text, u.warehouse_id::text,
  c.name AS company_name, w.name AS warehouse_name, u.purchase_line_id, u.bill_number, u.receipt_date::text,
  u.item_code, u.item_name, u.size_label, u.quantity::text, u.unit, u.bundle_no::int, u.bundle_count::int,
  u.weight_basis, u.status, u.void_reason, u.created_at::text, u.lifecycle_status, l.code AS location_code,
  u.status_reason, u.source_type, u.parent_unit_id::text, u.part_no::int, u.item_master_id::text,
  u.material_type_id::text, u.current_vendor_id::text, u.current_vendor_name, u.at_vendor_since::text,
  u.output_receipt_id::text, r.receipt_no, u.job_work_output_item_id::text`

export const UNIT_FROM = `tracking_units u
  LEFT JOIN companies c ON c.id = u.company_id
  LEFT JOIN warehouses w ON w.id = u.warehouse_id
  LEFT JOIN tracking_locations l ON l.id = u.current_location_id
  LEFT JOIN tracking_output_receipts r ON r.id = u.output_receipt_id`

export function toUnit(row: Row): TrackingUnit {
  return {
    ...row,
    bundle_no: Number(row.bundle_no),
    bundle_count: Number(row.bundle_count),
    part_no: row.part_no == null ? null : Number(row.part_no),
  } as unknown as TrackingUnit
}

export async function unitInScope(actor: TrackingActor, unitId: string): Promise<TrackingUnit> {
  const rows = await query(`SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE u.id = $1::uuid`, [requireUuid(unitId, 'Unit')])
  const unit = rows[0] ? toUnit(rows[0]) : null
  if (!unit || !actorCanAccess(actor, unit.company_id, unit.warehouse_id)) throw new TrackingError('Tracking unit not found', 404)
  return unit
}

async function assertEnabled(companyId: string, warehouseId: string): Promise<void> {
  const [row] = await query(`SELECT fn_tracking_is_enabled($1::uuid, $2::uuid) AS enabled`, [companyId, warehouseId])
  if (row.enabled !== 't') throw new TrackingError('QR tracking is switched off for this warehouse', 409)
}

// ── Receiving ───────────────────────────────────────────────────────────────

export async function listEligibleLines(actor: TrackingActor, search = ''): Promise<EligibleLine[]> {
  const params: unknown[] = []
  const scope = actorScopeSql(actor, 'b.company_id', 'b.warehouse_id', params)
  let filter = ''
  if (search.trim()) {
    params.push(likePattern(search.trim()))
    const p = `$${params.length}`
    filter = `AND (i.purchase_line_id ILIKE ${p} OR b.bill_number ILIKE ${p} OR im.item_code ILIKE ${p}
                   OR COALESCE(i.item_name, im.item_name) ILIKE ${p})`
  }
  const rows = await query(
    `SELECT i.purchase_line_id, COALESCE(i.received_quantity, i.quantity)::text AS quantity, i.unit,
            im.item_code, COALESCE(i.item_name, im.item_name) AS item_name, i.size_label, b.bill_number,
            b.bill_date::text, b.company_id::text, b.warehouse_id::text,
            c.name AS company_name, w.name AS warehouse_name
       FROM purchase_bill_items i
       JOIN purchase_bills b ON b.id = i.bill_id
       JOIN companies c ON c.id = b.company_id
       JOIN warehouses w ON w.id = b.warehouse_id
       LEFT JOIN item_master im ON im.id = i.item_master_id
      WHERE b.status = 'active'
        AND fn_tracking_is_enabled(b.company_id, b.warehouse_id)
        AND fn_tracking_line_is_new(i.created_at, b.bill_date, b.company_id, b.warehouse_id)
        AND NOT EXISTS (SELECT 1 FROM tracking_units t WHERE t.purchase_line_id = i.purchase_line_id AND t.status = 'ACTIVE')
        AND ${scope} ${filter}
      ORDER BY i.created_at DESC
      LIMIT 200`,
    params,
  )
  return rows as unknown as EligibleLine[]
}

export interface BundleInput {
  quantity: string
  weight_basis: 'weighed' | 'estimated'
}

export async function createUnits(actor: TrackingActor, purchaseLineId: unknown, bundles: unknown): Promise<TrackingUnit[]> {
  if (typeof purchaseLineId !== 'string' || !purchaseLineId.trim()) throw new TrackingError('Choose a purchase line')
  const lineId = purchaseLineId.trim()
  if (bundles != null && (!Array.isArray(bundles) || bundles.length > MAX_BUNDLES)) {
    throw new TrackingError(`A purchase line can have at most ${MAX_BUNDLES} bundles`)
  }

  const [line] = await query(
    `SELECT b.company_id::text, b.warehouse_id::text
       FROM purchase_bill_items i JOIN purchase_bills b ON b.id = i.bill_id
      WHERE i.purchase_line_id = $1`,
    [lineId],
  )
  if (!line || !line.company_id || !line.warehouse_id || !actorCanAccess(actor, line.company_id, line.warehouse_id)) {
    throw new TrackingError('Purchase line not found', 404)
  }

  const created = await query(
    `SELECT id::text FROM create_tracking_units($1, $2::jsonb, $3::uuid)`,
    [lineId, bundles == null ? null : JSON.stringify(bundles), actor.userId],
  )
  const ids = created.map((row) => row.id)
  const rows = await query(`SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE u.id = ANY($1::uuid[]) ORDER BY u.bundle_no`, [ids])
  return rows.map(toUnit)
}

// ── Units ───────────────────────────────────────────────────────────────────

export async function listUnits(
  actor: TrackingActor,
  options: { search?: string; status?: string; lifecycle?: string } = {},
): Promise<TrackingUnit[]> {
  const params: unknown[] = []
  const conditions = [actorScopeSql(actor, 'u.company_id', 'u.warehouse_id', params)]
  if (options.status === 'ACTIVE' || options.status === 'VOIDED') {
    params.push(options.status)
    conditions.push(`u.status = $${params.length}`)
  }
  if (options.lifecycle && options.lifecycle in LIFECYCLE_LABELS) {
    params.push(options.lifecycle as LifecycleStatus)
    conditions.push(`u.lifecycle_status = $${params.length} AND u.status = 'ACTIVE'`)
  }
  if (options.search?.trim()) {
    params.push(likePattern(options.search.trim()))
    const p = `$${params.length}`
    // A purchase line also finds every output and remainder that descends from it.
    conditions.push(`(u.stock_tracking_id ILIKE ${p} OR u.purchase_line_id ILIKE ${p} OR u.bill_number ILIKE ${p}
                      OR u.item_code ILIKE ${p} OR u.item_name ILIKE ${p} OR u.current_vendor_name ILIKE ${p}
                      OR r.receipt_no ILIKE ${p}
                      OR EXISTS (SELECT 1 FROM tracking_unit_origins o WHERE o.tracking_unit_id = u.id AND o.purchase_line_id ILIKE ${p}))`)
  }
  const rows = await query(
    `SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE ${conditions.join(' AND ')} ORDER BY u.created_at DESC, u.bundle_no LIMIT 300`,
    params,
  )
  return rows.map(toUnit)
}

/** Compares a unit with today's purchase record. Reports differences and changes nothing. */
export async function sourceWarnings(unit: TrackingUnit): Promise<string[]> {
  const warnings: string[] = []
  if (unit.status === 'VOIDED') warnings.push(`Do not use. This label was voided: ${unit.void_reason ?? 'no reason recorded'}`)
  if (unit.status === 'ACTIVE' && unit.lifecycle_status === 'SPLIT') {
    warnings.push('Do not use. This bundle was split, so use the labels on its parts')
  }
  if (unit.status === 'ACTIVE' && unit.lifecycle_status === 'PROCESSED') {
    warnings.push('Do not use. This bundle was used up in job work, so use the labels on its outputs')
  }
  // An output made from several purchase lines has no single line to compare with.
  if (!unit.purchase_line_id) return warnings

  // A split original is replaced by its parts, so only the parts count towards the labelled total.
  // Outputs and remainders are made later from those bundles, so they never count towards it.
  const [source] = await query(
    `SELECT COALESCE(i.received_quantity, i.quantity)::text AS quantity, b.status,
            (SELECT COALESCE(SUM(t.quantity), 0)::text FROM tracking_units t
              WHERE t.purchase_line_id = i.purchase_line_id AND t.status = 'ACTIVE' AND t.lifecycle_status <> 'SPLIT'
                AND t.source_type IN ('NEW_PURCHASE', 'VERIFIED_EXISTING', 'SPLIT_PART') AND t.output_receipt_id IS NULL) AS labelled,
            (SELECT t.source_verification_id IS NOT NULL FROM tracking_units t WHERE t.id = $2::uuid) AS verified,
            (SELECT COALESCE(SUM(t.quantity), 0)::text FROM tracking_units t
              WHERE t.purchase_line_id = i.purchase_line_id AND t.company_id = $3::uuid AND t.warehouse_id = $4::uuid
                AND t.status = 'ACTIVE' AND t.lifecycle_status IN ('LABELLED', 'IN_STOCK', 'ON_PICKUP', 'READY', 'ON_HOLD')) AS on_hand,
            (SELECT COALESCE(SUM(s.quantity), 0)::text FROM stock_ledger s
              WHERE s.purchase_line_id = i.purchase_line_id AND s.company_id = $3::uuid AND s.warehouse_id = $4::uuid) AS book
       FROM purchase_bill_items i JOIN purchase_bills b ON b.id = i.bill_id
      WHERE i.purchase_line_id = $1`,
    [unit.purchase_line_id, unit.id, unit.company_id, unit.warehouse_id],
  )
  if (!source) {
    warnings.push(`Purchase line ${unit.purchase_line_id} no longer exists on its bill`)
  } else {
    if (source.status !== 'active') warnings.push(`The purchase bill for this label is ${source.status}`)
    // Verified old stock is only part of its purchase line, so the labels are not expected to add up to it.
    const fromPurchase = unit.source_type === 'NEW_PURCHASE' || unit.source_type === 'SPLIT_PART'
    if (unit.status === 'ACTIVE' && fromPurchase && source.verified !== 't' && Number(source.quantity) !== Number(source.labelled)) {
      warnings.push(`Purchase line quantity is now ${source.quantity} ${unit.unit}, but its labels total ${source.labelled} ${unit.unit}`)
    }
    if (unit.status === 'ACTIVE' && Number(source.on_hand) > Number(source.book)) {
      warnings.push(`Bundles on hand for this purchase line total ${source.on_hand} ${unit.unit}, above its book stock of ${source.book} ${unit.unit}`)
    }
  }
  return warnings
}

export async function getUnitDetail(actor: TrackingActor, unitId: string) {
  const unit = await unitInScope(actor, unitId)
  const [events, printJobs, warnings] = await Promise.all([
    query(
      `SELECT e.id::text, e.event_type, e.details::text, e.occurred_at::text, p.full_name AS actor_name,
              e.offline_action_id::text, oa.received_at::text AS synced_at
         FROM tracking_events e
         LEFT JOIN user_profiles p ON p.id = e.actor_id
         LEFT JOIN tracking_offline_actions oa ON oa.id = e.offline_action_id
        WHERE e.tracking_unit_id = $1::uuid ORDER BY e.occurred_at DESC LIMIT 200`,
      [unit.id],
    ),
    query(
      `SELECT j.id::text, j.job_type, j.status, j.reason, j.created_at::text, pr.name AS printer_name, p.full_name AS requested_by_name
         FROM tracking_print_jobs j
         LEFT JOIN tracking_printers pr ON pr.id = j.printer_id
         LEFT JOIN user_profiles p ON p.id = j.requested_by
        WHERE j.tracking_unit_id = $1::uuid ORDER BY j.created_at DESC`,
      [unit.id],
    ),
    sourceWarnings(unit),
  ])
  return { unit, events, printJobs, warnings }
}

export async function voidUnit(actor: TrackingActor, unitId: string, reason: unknown): Promise<TrackingUnit> {
  const unit = await unitInScope(actor, unitId)
  await query(`SELECT id FROM void_tracking_unit($1::uuid, $2, $3::uuid)`, [unit.id, typeof reason === 'string' ? reason : '', actor.userId])
  return unitInScope(actor, unit.id)
}

// ── Scan ────────────────────────────────────────────────────────────────────

export type LookupResult =
  | { kind: 'found'; unit: TrackingUnit; warnings: string[]; printCount: number }
  | { kind: 'test' | 'invalid' | 'not_found' | 'other_company' }

/** Looks a label up. The only thing it records is a history event on the tracking unit. */
export async function lookupCode(actor: TrackingActor, rawCode: unknown): Promise<LookupResult> {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
  if (code === TEST_LABEL_CODE) return { kind: 'test' }
  const isQr = QR_REFERENCE_RE.test(code)
  if (!isQr && !STOCK_TRACKING_ID_RE.test(code)) return { kind: 'invalid' }

  const rows = await query(
    `SELECT ${UNIT_COLUMNS} FROM ${UNIT_FROM} WHERE ${isQr ? 'u.qr_reference' : 'u.stock_tracking_id'} = $1`,
    [code],
  )
  if (!rows[0]) return { kind: 'not_found' }
  const unit = toUnit(rows[0])
  if (!actorCanAccess(actor, unit.company_id, unit.warehouse_id)) return { kind: 'other_company' }

  await query(
    `INSERT INTO tracking_events (tracking_unit_id, event_type, details, actor_id)
     VALUES ($1::uuid, 'SCAN_LOOKUP', $2::jsonb, $3::uuid)`,
    [unit.id, JSON.stringify({ method: isQr ? 'qr' : 'tracking_id' }), actor.userId],
  )
  const [count] = await query(
    `SELECT count(*)::int AS n FROM tracking_print_jobs WHERE tracking_unit_id = $1::uuid AND status IN ('sent', 'confirmed')`,
    [unit.id],
  )
  return { kind: 'found', unit, warnings: await sourceWarnings(unit), printCount: Number(count.n) }
}

// ── Printing ────────────────────────────────────────────────────────────────

export async function activeTemplate(kind: 'BUNDLE' | 'LOCATION' = 'BUNDLE'): Promise<LabelTemplate & { id: string }> {
  const [row] = await query(
    `SELECT id::text, zpl_body, width_mm::text, height_mm::text, dpi::int
       FROM tracking_label_templates WHERE is_active AND template_kind = $1 ORDER BY created_at DESC, version DESC LIMIT 1`,
    [kind],
  )
  if (!row) throw new TrackingError('No label template is active', 409)
  return row as unknown as LabelTemplate & { id: string }
}

export async function printerInScope(actor: TrackingActor, printerId: unknown): Promise<TrackingPrinter> {
  const [row] = await query(
    `SELECT id::text, company_id::text, warehouse_id::text, name, model, dpi::int, label_width_mm::text, label_height_mm::text, is_active
       FROM tracking_printers WHERE id = $1::uuid`,
    [requireUuid(printerId, 'Printer')],
  )
  if (!row || !actorCanAccess(actor, row.company_id, row.warehouse_id)) throw new TrackingError('Printer not found', 404)
  return { ...row, dpi: Number(row.dpi), is_active: row.is_active === 't' } as unknown as TrackingPrinter
}

export interface PrintRequestResult {
  jobId: string
  jobType: string
  /** For Zebra Browser Print. */
  zpl: string
  /** The same label for the print dialog, so it can go to any printer. */
  label: PrintableLabel
}

/** The label at the printer's label size, for printing through the browser's print dialog. */
export function printableLabel(layout: LabelLayout, printer: LabelPrinterSetup, fields: LabelFields | Record<string, string>): PrintableLabel {
  return {
    layout,
    fields: { ...fields },
    width_mm: Number(printer.label_width_mm),
    height_mm: Number(printer.label_height_mm),
  }
}

/** Records the request and returns the label. It never creates a unit or moves stock. */
export async function requestPrint(actor: TrackingActor, unitId: string, printerId: unknown, reason: unknown): Promise<PrintRequestResult> {
  const unit = await unitInScope(actor, unitId)
  await assertEnabled(unit.company_id, unit.warehouse_id)
  const printer = await printerInScope(actor, printerId)
  const template = await activeTemplate()

  const [job] = await query(
    `SELECT id::text, job_type FROM request_tracking_print($1::uuid, $2::uuid, $3::uuid, $4, $5::boolean, $6::uuid)`,
    [unit.id, printer.id, template.id, typeof reason === 'string' ? reason : null, TRACKING_ROLES.reprint_void.has(actor.role), actor.userId],
  )
  const fields = labelFieldsForUnit(unit as unknown as UnitForLabel)
  return { jobId: job.id, jobType: job.job_type, zpl: buildLabelZpl(template, printer, fields), label: printableLabel('bundle', printer, fields) }
}

export async function requestTestPrint(actor: TrackingActor, printerId: unknown): Promise<PrintRequestResult> {
  const printer = await printerInScope(actor, printerId)
  if (!printer.is_active) throw new TrackingError('Choose an active printer', 409)
  const template = await activeTemplate()
  const [job] = await query(
    `INSERT INTO tracking_print_jobs (job_type, printer_id, template_id, requested_by)
     VALUES ('TEST', $1::uuid, $2::uuid, $3::uuid) RETURNING id::text, job_type`,
    [printer.id, template.id, actor.userId],
  )
  const fields = testLabelFields(printer.name)
  return { jobId: job.id, jobType: job.job_type, zpl: buildLabelZpl(template, printer, fields), label: printableLabel('bundle', printer, fields) }
}

export async function setPrintStatus(actor: TrackingActor, jobId: string, status: unknown): Promise<PrintStatus> {
  if (status !== 'sent' && status !== 'confirmed' && status !== 'failed') throw new TrackingError('Print status is not valid')
  const [job] = await query(
    `SELECT p.company_id::text, p.warehouse_id::text
       FROM tracking_print_jobs j JOIN tracking_printers p ON p.id = j.printer_id WHERE j.id = $1::uuid`,
    [requireUuid(jobId, 'Print job')],
  )
  if (!job || !actorCanAccess(actor, job.company_id, job.warehouse_id)) throw new TrackingError('Print job not found', 404)
  const [updated] = await query(`SELECT status FROM set_tracking_print_status($1::uuid, $2, $3::uuid)`, [jobId, status, actor.userId])
  return updated.status as PrintStatus
}

export async function listPrinters(actor: TrackingActor): Promise<TrackingPrinter[]> {
  const params: unknown[] = []
  const scope = actorScopeSql(actor, 'p.company_id', 'p.warehouse_id', params)
  const rows = await query(
    `SELECT p.id::text, p.company_id::text, p.warehouse_id::text, w.name AS warehouse_name, p.name, p.model, p.dpi::int,
            p.label_width_mm::text, p.label_height_mm::text, p.is_active
       FROM tracking_printers p LEFT JOIN warehouses w ON w.id = p.warehouse_id
      WHERE ${scope} ORDER BY w.name, p.name`,
    params,
  )
  return rows.map((row) => ({ ...row, dpi: Number(row.dpi), is_active: row.is_active === 't' })) as unknown as TrackingPrinter[]
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(actor: TrackingActor) {
  const [companies, warehouses, flags, gpsFlags, printers, templates] = await Promise.all([
    query(`SELECT id::text, name FROM companies WHERE is_active ORDER BY name`),
    query(`SELECT id::text, company_id::text, name FROM warehouses WHERE is_active ORDER BY name`),
    query(`SELECT company_id::text, warehouse_id::text, enabled, tracking_start_at::text FROM tracking_feature_flags WHERE feature_key = 'qr_tracking'`),
    query(`SELECT company_id::text FROM tracking_feature_flags WHERE feature_key = 'gps_capture' AND warehouse_id IS NULL AND enabled`),
    listPrinters(actor),
    query(`SELECT name, version::int, width_mm::text, height_mm::text, dpi::int FROM tracking_label_templates WHERE is_active ORDER BY created_at DESC`),
  ])
  return {
    companies,
    warehouses,
    flags: flags.map((flag) => ({ ...flag, enabled: flag.enabled === 't' })),
    gpsCompanies: gpsFlags.map((flag) => flag.company_id),
    printers,
    templates,
  }
}

/** GPS is switched per company and is off until an admin turns it on. */
export async function setGpsFlag(actor: TrackingActor, companyIdInput: unknown, enabled: unknown): Promise<void> {
  assertCan(actor, 'settings')
  const companyId = requireUuid(companyIdInput, 'Company')
  if (typeof enabled !== 'boolean') throw new TrackingError('Choose on or off')
  await query(
    `INSERT INTO tracking_feature_flags (company_id, warehouse_id, feature_key, enabled, changed_by)
     VALUES ($1::uuid, NULL, 'gps_capture', $2::boolean, $3::uuid)
     ON CONFLICT (company_id, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), feature_key)
     DO UPDATE SET enabled = EXCLUDED.enabled, changed_by = EXCLUDED.changed_by, updated_at = now()`,
    [companyId, enabled, actor.userId],
  )
}

/** The companies whose scans should ask the device for a position. */
export async function gpsCompanyIds(): Promise<string[]> {
  const rows = await query(`SELECT company_id::text FROM tracking_feature_flags WHERE feature_key = 'gps_capture' AND warehouse_id IS NULL AND enabled`)
  return rows.map((row) => row.company_id)
}

async function assertWarehouseInCompany(companyId: string, warehouseId: string): Promise<void> {
  const [row] = await query(`SELECT 1 AS ok FROM warehouses WHERE id = $1::uuid AND company_id = $2::uuid`, [warehouseId, companyId])
  if (!row) throw new TrackingError('That warehouse does not belong to this company')
}

/** enabled = null removes a warehouse's own setting, so it follows its company again. */
export async function setFeatureFlag(actor: TrackingActor, companyIdInput: unknown, warehouseIdInput: unknown, enabled: unknown): Promise<void> {
  const companyId = requireUuid(companyIdInput, 'Company')
  const warehouseId = warehouseIdInput == null || warehouseIdInput === '' ? null : requireUuid(warehouseIdInput, 'Warehouse')
  if (warehouseId) await assertWarehouseInCompany(companyId, warehouseId)

  if (enabled === null) {
    if (!warehouseId) throw new TrackingError('A company must be either on or off')
    await query(`DELETE FROM tracking_feature_flags WHERE company_id = $1::uuid AND warehouse_id = $2::uuid AND feature_key = 'qr_tracking'`, [companyId, warehouseId])
    return
  }
  if (typeof enabled !== 'boolean') throw new TrackingError('Choose on or off')

  await query(
    `INSERT INTO tracking_feature_flags (company_id, warehouse_id, enabled, tracking_start_at, changed_by)
     VALUES ($1::uuid, $2::uuid, $3::boolean, CASE WHEN $3::boolean THEN now() END, $4::uuid)
     ON CONFLICT (company_id, COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), feature_key)
     DO UPDATE SET enabled = EXCLUDED.enabled,
                   tracking_start_at = COALESCE(tracking_feature_flags.tracking_start_at, EXCLUDED.tracking_start_at),
                   changed_by = EXCLUDED.changed_by,
                   updated_at = now()`,
    [companyId, warehouseId, enabled, actor.userId],
  )
}

export interface PrinterInput {
  id?: unknown
  company_id?: unknown
  warehouse_id?: unknown
  name?: unknown
  model?: unknown
  dpi?: unknown
  label_width_mm?: unknown
  label_height_mm?: unknown
  is_active?: unknown
}

export async function savePrinter(actor: TrackingActor, input: PrinterInput): Promise<void> {
  const companyId = requireUuid(input.company_id, 'Company')
  const warehouseId = requireUuid(input.warehouse_id, 'Warehouse')
  await assertWarehouseInCompany(companyId, warehouseId)

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : 'Zebra ZPL printer'
  const dpi = Number(input.dpi ?? 203)
  const width = Number(input.label_width_mm ?? 100)
  const height = Number(input.label_height_mm ?? 50)
  if (!name) throw new TrackingError('Give the printer a name')
  if (![203, 300, 600].includes(dpi)) throw new TrackingError('Resolution must be 203, 300 or 600 dpi')
  if (!(width >= 25 && width <= 220) || !(height >= 25 && height <= 300)) throw new TrackingError('Label size is outside the printable range')
  const active = input.is_active !== false

  if (input.id) {
    const rows = await query(
      `UPDATE tracking_printers
          SET company_id = $2::uuid, warehouse_id = $3::uuid, name = $4, model = $5, dpi = $6::int,
              label_width_mm = $7::numeric, label_height_mm = $8::numeric, is_active = $9::boolean, updated_at = now()
        WHERE id = $1::uuid RETURNING id`,
      [requireUuid(input.id, 'Printer'), companyId, warehouseId, name, model, dpi, width, height, active],
    )
    if (!rows[0]) throw new TrackingError('Printer not found', 404)
    return
  }
  await query(
    `INSERT INTO tracking_printers (company_id, warehouse_id, name, model, dpi, label_width_mm, label_height_mm, is_active, created_by)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5::int, $6::numeric, $7::numeric, $8::boolean, $9::uuid)`,
    [companyId, warehouseId, name, model, dpi, width, height, active, actor.userId],
  )
}
