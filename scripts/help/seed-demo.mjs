#!/usr/bin/env node
// Demo data for the Help screenshots and the user-guide PowerPoint.
//
// Seeds an EMPTY WareCore database (all migrations applied, default demo
// user present, nothing else) with fictional companies, parties, items,
// purchases, job work, sales, a customer return, a transfer and accounts
// entries — so screenshots show realistic screens without any real
// business data. Never run this against a live database: it refuses to
// touch a database that already has purchase bills.
//
// Usage: node scripts/help/seed-demo.mjs <postgres connection string>

import pg from 'pg'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'

const cs = process.argv[2]
if (!cs) { console.error('Usage: node scripts/help/seed-demo.mjs <connection string>'); process.exit(1) }
const c = new pg.Client({ connectionString: cs })
await c.connect()

const one = async (sql, params = []) => (await c.query(sql, params)).rows[0]
const { n } = await one('SELECT (SELECT count(*) FROM purchase_bills) + (SELECT count(*) FROM companies) AS n')
if (Number(n) > 0) { console.error('This database already has purchase bills — refusing to seed demo data (it needs an empty database).'); process.exit(1) }

await c.query('BEGIN')
const admin = await one(`UPDATE user_profiles SET full_name = 'Demo Admin' WHERE email = 'testuser' RETURNING id`)
const U = admin.id

// ── Masters ──────────────────────────────────────────────────────────────
const company = async (name, code, gstin, city) =>
  (await one(`INSERT INTO companies (name, code, short_name, gstin, city, state, address, phone, is_active)
              VALUES ($1,$2,$2,$3,$4,'Tamil Nadu','Plot 12, SIDCO Industrial Estate','044-2625 0000',true) RETURNING id`, [name, code, gstin, city])).id
const SUN = await company('Sunrise Steels Pvt Ltd', 'SUN', '33AAACS1234F1Z5', 'Chennai')
const APX = await company('Apex Metal Works', 'APX', '33AAKFA5678G1Z2', 'Coimbatore')

const wh = async (cid, name, city) => (await one(`INSERT INTO warehouses (company_id, name, city, state, address, is_active) VALUES ($1,$2,$3,'Tamil Nadu','Industrial Estate',true) RETURNING id`, [cid, name, city])).id
const SUN_MAIN = await wh(SUN, 'Main Yard', 'Chennai')
const SUN_U2 = await wh(SUN, 'Unit 2 Store', 'Chennai')
const APX_GD = await wh(APX, 'Apex Godown', 'Coimbatore')

const party = async (table, name, person, gstin, city) =>
  (await one(`INSERT INTO ${table} (name, contact_person, phone, gstin, city, state, is_active) VALUES ($1,$2,'98400 00000',$3,$4,'Tamil Nadu',true) RETURNING id`, [name, person, gstin, city])).id
const BHARAT = await party('suppliers', 'Bharat Coil Traders', 'Suresh', '33AABFB1111C1Z1', 'Chennai')
const METRO = await party('suppliers', 'Metro Steel Suppliers', 'Anand', '33AABFM2222D1Z2', 'Chennai')
const SLIT = await party('suppliers', 'Precision Slitters', 'Karthik', '33AABFP3333E1Z3', 'Sriperumbudur')
const KIRAN = await party('suppliers', 'Kiran Cutting Works', 'Kiran', '33AABFK4444F1Z4', 'Ambattur')
const GALVA = await party('suppliers', 'Galva Coat Industries', 'Ramesh', '33AABFG5555G1Z5', 'Hosur')
const NOVA = await party('customers', 'Nova Fabricators', 'Priya', '33AACFN6666H1Z6', 'Chennai')
const DELTA = await party('customers', 'Delta Roofing Co', 'Vijay', '33AACFD7777J1Z7', 'Vellore')
const PRIME = await party('customers', 'Prime Engineering Works', 'Lakshmi', '33AACFP8888K1Z8', 'Coimbatore')
const VISTA = await party('customers', 'Vista Builders', 'Arun', '33AACFV9999L1Z9', 'Madurai')

// Material types come from the migrations' standard list (CR, GA, GI, HR, OT).
const mt = async (code) => (await one(`SELECT id FROM material_types WHERE code = $1`, [code])).id
const MT = { GA: await mt('GA'), CR: await mt('CR'), HR: await mt('HR'), GI: await mt('GI') }

const items = {}
async function item(type, size, thickness, width) {
  const s = (await one(`SELECT id FROM material_sizes WHERE material_type_id = $1 AND size_label = $2`, [MT[type], size]))
    ?? await one(`INSERT INTO material_sizes (material_type_id, size_label, thickness, width, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [MT[type], size, thickness, width])
  const existing = await one(`SELECT id, item_code FROM item_master WHERE material_type_id = $1 AND material_size_id = $2 LIMIT 1`, [MT[type], s.id])
  if (existing) {
    items[`${type} ${size}`] = { type, size, sizeId: s.id, itemId: existing.id, code: existing.item_code, name: `${type} ${size}` }
    return items[`${type} ${size}`]
  }
  const max = await one(`SELECT coalesce(max(substring(item_code from $1)::int), 0) AS m FROM item_master`, [`^${type}([0-9]+)$`])
  const code = `${type}${String(max.m + 1).padStart(5, '0')}`
  const im = await one(`INSERT INTO item_master (item_code, item_name, material_type_id, material_size_id, size_label, unit, is_active) VALUES ($1,$2,$3,$4,$5,'MT',true) RETURNING id`,
    [code, `${type} ${size}`, MT[type], s.id, size])
  items[`${type} ${size}`] = { type, size, sizeId: s.id, itemId: im.id, code, name: `${type} ${size}` }
  return items[`${type} ${size}`]
}
const GA1250 = await item('GA', '0.80 X 1250', 0.8, 1250)
const GA121 = await item('GA', '0.80 X 121', 0.8, 121)
const GA164 = await item('GA', '0.80 X 164', 0.8, 164)
const CR1250 = await item('CR', '1.00 X 1250', 1, 1250)
const CR150 = await item('CR', '1.00 X 150', 1, 150)
const HR1250 = await item('HR', '2.00 X 1250', 2, 1250)
const GP1220 = await item('GI', '0.50 X 1220', 0.5, 1220)
const GP150 = await item('GI', '0.50 X 150', 0.5, 150)

const GST = (await one(`SELECT id FROM tax_rates WHERE name = 'GST 18%'`)).id

// Users and a custom role
const hash = await bcrypt.hash('DemoPass123', 10)
for (const [name, email, role] of [['Meena Store', 'meena@sunrise.example', 'warehouse_manager'], ['Ravi Accounts', 'ravi@sunrise.example', 'billing_staff'], ['Divya Sales', 'divya@sunrise.example', 'sales_manager']]) {
  await c.query(`INSERT INTO user_profiles (id, full_name, email, password_hash, role, is_active, company_id) VALUES ($1,$2,$3,$4,$5,true,$6)`, [randomUUID(), name, email, hash, role, SUN]).catch(async () => {
    await c.query(`INSERT INTO user_profiles (id, full_name, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,'admin',true)`, [randomUUID(), name, email, hash])
  })
}
const role = await one(`INSERT INTO custom_roles (role_name, role_code, description) VALUES ('Store Manager','store_manager','Purchases, sales, stock and job work') RETURNING id`)
for (const [code, w] of [['dashboard', false], ['bills', true], ['dispatch', true], ['inventory', false], ['movements', false], ['transfers', true], ['jobwork', true], ['reports_stock', false]]) {
  await c.query(`INSERT INTO role_permissions (role_id, screen_code, can_read, can_write) VALUES ($1,$2,true,$3)`, [role.id, code, w])
}

// ── Purchases ────────────────────────────────────────────────────────────
const mmyy = (d) => d.slice(5, 7) + d.slice(2, 4)
let billSeq = {}
const lineSeq = {}
const money = (qty, rate) => {
  const taxable = Math.round(qty * rate * 100) / 100
  const g = Math.round(taxable * 0.09 * 100) / 100
  return { taxable, cgst: g, sgst: g, total: Math.round((taxable + 2 * g) * 100) / 100 }
}
async function bill(date, supplier, cid, wid, lines, status = 'active', notes = null) {
  const m = mmyy(date)
  billSeq[m] = (billSeq[m] ?? 0) + 1
  const b = await one(`INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status, notes, created_by, updated_by)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id, bill_number`, [supplier, cid, wid, `${m}-${String(billSeq[m]).padStart(4, '0')}`, date, status, notes, U])
  const out = []
  let ln = 0
  for (const [it, qty, rate, recv] of lines) {
    const key = it.type + m
    lineSeq[key] = (lineSeq[key] ?? 0) + 1
    const pl = `${it.type}${m}-${String(lineSeq[key]).padStart(4, '0')}`
    const x = money(qty, rate)
    ln += 1
    await c.query(`INSERT INTO purchase_bill_items (bill_id, material_type_id, material_size_id, size_label, quantity, received_quantity, unit, rate, amount, item_name, purchase_line_id, line_number, item_master_id, tax_rate_id, taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, total_with_tax)
                   VALUES ($1,$2,$3,$4,$5,$6,'MT',$7,$8,$9,$10,$11,$12,$13,$8,9,$14,9,$15,$16)`,
      [b.id, MT[it.type], it.sizeId, it.size, qty, recv ?? null, rate, x.taxable, it.name, pl, ln, it.itemId, GST, x.cgst, x.sgst, x.total])
    out.push(pl)
  }
  return { id: b.id, number: b.bill_number, lines: out }
}
const B1 = await bill('2026-08-04', BHARAT, SUN, SUN_MAIN, [[GA1250, 12.45, 61500], [CR1250, 8.2, 58200]], 'active', 'Supplier invoice BCT/2026/0412')
const B2 = await bill('2026-08-18', METRO, SUN, SUN_MAIN, [[HR1250, 15.6, 52400], [GP1220, 6.35, 64800, 6.31]], 'active', 'Supplier invoice MSS-2291')
const B3 = await bill('2026-09-03', BHARAT, SUN, SUN_MAIN, [[GA1250, 10.8, 62200], [CR1250, 9.15, 57900]], 'active', 'Supplier invoice BCT/2026/0577')
const B4 = await bill('2026-09-22', METRO, APX, APX_GD, [[CR1250, 7.4, 58600], [HR1250, 11.2, 53100]], 'active', 'Supplier invoice MSS-2410')
const B5 = await bill('2026-10-06', BHARAT, SUN, SUN_U2, [[GP1220, 5.9, 65100], [GA1250, 9.65, 61900]], 'active', 'Supplier invoice BCT/2026/0691')
const B6 = await bill('2026-11-10', METRO, SUN, SUN_MAIN, [[HR1250, 9.8, 52950]], 'active', 'Supplier invoice MSS-2534')
await bill('2026-11-12', BHARAT, SUN, SUN_MAIN, [[CR1250, 6.5, 58400]], 'draft', 'Awaiting weighbridge slip')

// ── Job work ─────────────────────────────────────────────────────────────
const jobLines = {}
const jl = (date) => {
  const ddmm = date.slice(8, 10) + date.slice(5, 7)
  jobLines[ddmm] = (jobLines[ddmm] ?? 0) + 1
  return `JW-${ddmm}-${String(jobLines[ddmm]).padStart(4, '0')}`
}
let jwRef = 0
const ref = (p) => `${p}-DEMO${String(++jwRef).padStart(4, '0')}`
async function jobWork(date, expected, vendor, cid, wid, desc, inputs) {
  const lines = inputs.map(([it, pl, qty]) => ({
    purchase_line_id: pl, job_line_id: jl(date), item_master_id: it.itemId, item_name: it.name,
    material_type_id: MT[it.type], material_size_id: it.sizeId, size_label: it.size, quantity_sent: qty, unit: 'MT',
  }))
  const r = await one(`SELECT create_job_work_order($1,$2,$3,$4,$5,$6,$7,'dispatched',NULL,$8::jsonb,'[]'::jsonb,$9) AS r`,
    [ref('JW'), cid, wid, vendor, date, expected, desc, JSON.stringify(lines), U])
  if (!r.r.success) throw new Error('job work: ' + JSON.stringify(r.r))
  const id = r.r.job_work_order_id
  const its = (await c.query(`SELECT id, job_line_id FROM job_work_items WHERE job_work_order_id = $1 ORDER BY job_line_id`, [id])).rows
  return { id, items: its, lines }
}
// Records produced output the way the app's Edit Order screen does: through
// edit_job_work_order(), with each input line's quantity_received set to the
// output booked against its job line.
async function outputs(order, outs) {
  const { rows: ins } = await c.query(`SELECT * FROM job_work_items WHERE job_work_order_id = $1`, [order.id])
  const { rows: existing } = await c.query(`SELECT * FROM job_work_output_items WHERE job_work_order_id = $1`, [order.id])
  const outItems = [
    ...existing.map((o) => ({ id: o.id, item_master_id: o.item_master_id, item_name: o.item_name, material_type_id: o.material_type_id, material_size_id: o.material_size_id, size_label: o.size_label, quantity: Number(o.quantity), unit: o.unit, source_job_line_id: o.source_job_line_id, received_date: o.received_date })),
    ...outs.map(([srcLine, it, qty, date]) => ({ id: null, item_master_id: it.itemId, item_name: it.name, material_type_id: MT[it.type], material_size_id: it.sizeId, size_label: it.size, quantity: qty, unit: 'MT', source_job_line_id: srcLine, received_date: date })),
  ]
  const received = (jl) => outItems.filter((o) => o.source_job_line_id === jl).reduce((t, o) => t + o.quantity, 0)
  const inItems = ins.map((i) => ({ id: i.id, purchase_line_id: i.purchase_line_id, sub_purchase_line_id: i.sub_purchase_line_id, job_line_id: i.job_line_id, item_master_id: i.item_master_id, item_name: i.item_name, material_type_id: i.material_type_id, material_size_id: i.material_size_id, size_label: i.size_label, quantity_sent: Number(i.quantity_sent), quantity_received: received(i.job_line_id), unit: i.unit, notes: i.notes }))
  const { rows: [o] } = await c.query(`SELECT * FROM job_work_orders WHERE id = $1`, [order.id])
  const r = await one(`SELECT edit_job_work_order($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) AS r`,
    [o.id, o.company_id, o.warehouse_id, o.vendor_id, o.dispatch_date, o.expected_return_date, o.work_description, o.notes, JSON.stringify(inItems), JSON.stringify(outItems)])
  if (!r.r.success) throw new Error('outputs: ' + JSON.stringify(r.r))
}
// Slitting: GA coil → 121 mm and 164 mm strips (completed)
const J1 = await jobWork('2026-08-10', '2026-08-20', SLIT, SUN, SUN_MAIN, 'Coil Slitting', [[GA1250, B1.lines[0], 12.45]])
await outputs(J1, [[J1.lines[0].job_line_id, GA121, 6.2, '2026-08-19'], [J1.lines[0].job_line_id, GA164, 6.25, '2026-08-19']])
// CR slitting (part returned, rest still at vendor)
const J2 = await jobWork('2026-09-08', '2026-09-25', KIRAN, SUN, SUN_MAIN, 'Sheet Cutting', [[CR1250, B1.lines[1], 8.2], [CR1250, B3.lines[1], 4.5]])
await outputs(J2, [[J2.lines[0].job_line_id, CR150, 5.1, '2026-09-24']])
// Pending at vendor, later partly moved to another vendor
const J3 = await jobWork('2026-10-09', '2026-10-30', SLIT, SUN, SUN_U2, 'Coil Slitting', [[GA1250, B5.lines[1], 9.65]])
const J4 = await jobWork('2026-10-15', '2026-11-05', KIRAN, SUN, SUN_MAIN, 'Coil Slitting', [[GP1220, B2.lines[1], 6.31]])
await outputs(J4, [[J4.lines[0].job_line_id, GP150, 3.1, '2026-10-28']])
// Vendor-to-vendor transfer of part of J3
const t = await one(`SELECT create_job_work_transfer($1,$2,'2026-10-20',$3,'JWT-1026-0001','Vendor delay','Moved to clear backlog',$4::jsonb,$5) AS r`,
  [J3.id, KIRAN, ref('JW'), JSON.stringify([{ source_item_id: J3.items[0].id, job_line_id: J3.items[0].job_line_id, quantity: 3.5 }]), U])
if (!t.r.success) throw new Error('transfer: ' + JSON.stringify(t.r))
// Output sent on to galvanizing
const gpOut = await one(`SELECT id FROM job_work_output_items WHERE job_work_order_id = $1`, [J4.id])
const o = await one(`SELECT create_job_work_order_from_output($1,'2026-11-02',$2,'2026-11-20','Galvanizing',NULL,$3::jsonb,$4) AS r`,
  [GALVA, ref('JW'), JSON.stringify([{ source_output_item_id: gpOut.id, job_line_id: jl('2026-11-02'), quantity: 1.5 }]), U])
if (!o.r.success) throw new Error('output transfer: ' + JSON.stringify(o.r))

// ── Sales ────────────────────────────────────────────────────────────────
let saleSeq = {}
const saleLineSeq = {}
async function sale(date, customer, cid, wid, lines, opts = {}) {
  const m = mmyy(date)
  saleSeq[m] = (saleSeq[m] ?? 0) + 1
  const inv = `${m}-${String(saleSeq[m]).padStart(4, '0')}`
  const d = await one(`INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, vehicle_number, driver_name, status, notes, created_by, updated_by, is_vendor_direct, source_job_work_order_id)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12) RETURNING id`,
    [inv, customer, cid, wid, date, opts.vehicle ?? 'TN-05-AB-4321', opts.driver ?? 'Murugan', opts.status ?? 'active', opts.notes ?? null, U, !!opts.vendorJob, opts.vendorJob ?? null])
  const ids = []
  for (const [it, pl, qty, rate, srcJwItem] of lines) {
    const key = it.type + m
    saleLineSeq[key] = (saleLineSeq[key] ?? 0) + 1
    const x = money(qty, rate)
    const r = await one(`INSERT INTO dispatch_items (dispatch_order_id, material_type_id, material_size_id, size_label, quantity, unit, rate, amount, item_name, purchase_line_id, tax_rate_id, taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, total_with_tax, sale_line_id, item_master_id, source_job_work_item_id)
                         VALUES ($1,$2,$3,$4,$5,'MT',$6,$7,$8,$9,$10,$7,9,$11,9,$12,$13,$14,$15,$16) RETURNING id`,
      [d.id, MT[it.type], it.sizeId, it.size, qty, rate, x.taxable, it.name, pl, GST, x.cgst, x.sgst, x.total, `${it.type}${m}-${String(saleLineSeq[key]).padStart(4, '0')}`, it.itemId, srcJwItem ?? null])
    ids.push(r.id)
  }
  await c.query(`UPDATE dispatch_orders d SET total_quantity = x.q, total_amount = x.a FROM (SELECT sum(quantity) q, sum(amount) a FROM dispatch_items WHERE dispatch_order_id = $1) x WHERE d.id = $1`, [d.id])
  return { id: d.id, inv, items: ids }
}
const S1 = await sale('2026-08-26', NOVA, SUN, SUN_MAIN, [[GA121, B1.lines[0], 4.1, 68500], [GA164, B1.lines[0], 3.25, 68500]])
await sale('2026-09-05', DELTA, SUN, SUN_MAIN, [[HR1250, B2.lines[0], 7.8, 57900]], { vehicle: 'TN-23-CK-9087', driver: 'Selvam' })
const S3 = await sale('2026-09-29', PRIME, SUN, SUN_MAIN, [[CR150, B1.lines[1], 3.6, 64200], [GA121, B1.lines[0], 0.8, 68900]])
await sale('2026-10-12', VISTA, APX, APX_GD, [[HR1250, B4.lines[1], 6.4, 58300], [CR1250, B4.lines[0], 3.1, 63900]], { vehicle: 'TN-37-BZ-1120', driver: 'Ganesh' })
await sale('2026-10-25', NOVA, SUN, SUN_MAIN, [[HR1250, B2.lines[0], 4.2, 58100]])
await sale('2026-11-07', DELTA, SUN, SUN_MAIN, [[GA164, B1.lines[0], 1.8, 69200]])
await sale('2026-11-12', PRIME, SUN, SUN_MAIN, [[HR1250, B6.lines[0], 3.0, 58800]], { status: 'draft', notes: 'Rate to be confirmed' })
// Vendor direct sale: sell CR still at Kiran Cutting Works (J2, second line)
await sale('2026-10-03', PRIME, SUN, SUN_MAIN, [[CR1250, B3.lines[1], 2.0, 63500, J2.items[1].id]], { vendorJob: J2.id, vehicle: 'TN-09-AQ-7765', driver: 'Babu' })

// Customer return against S1 (part of the 164 mm strips)
const ret = await one(`SELECT create_sale_return($1,$2,'2026-09-02','Damaged in transit','Edge damage on 2 bundles',$3::jsonb,$4) AS r`,
  [randomUUID(), S1.id, JSON.stringify([{ dispatch_item_id: S1.items[1], quantity: 0.65 }]), U])
if (!ret.r.success) throw new Error('return: ' + JSON.stringify(ret.r))
await one(`SELECT create_sale_return($1,$2,'2026-10-04','Wrong size',NULL,$3::jsonb,$4) AS r`,
  [randomUUID(), S3.id, JSON.stringify([{ dispatch_item_id: S3.items[1], quantity: 0.5 }]), U])

// ── Transfer between companies ───────────────────────────────────────────
const tr = await one(`INSERT INTO transfers (reference_number, from_company_id, from_warehouse_id, to_company_id, to_warehouse_id, transfer_date, status, notes, created_by)
                      VALUES ('TR-0926-0001',$1,$2,$3,$4,'2026-09-15','completed','Stock shared for Coimbatore orders',$5) RETURNING id`, [SUN, SUN_MAIN, APX, APX_GD, U])
await c.query(`INSERT INTO transfer_items (transfer_id, material_type_id, material_size_id, size_label, quantity, unit, item_name, item_master_id, purchase_line_id)
               VALUES ($1,$2,$3,$4,2.5,'MT',$5,$6,$7)`, [tr.id, MT.HR, HR1250.sizeId, HR1250.size, HR1250.name, HR1250.itemId, B2.lines[0]])
const tr2 = await one(`INSERT INTO transfers (reference_number, from_company_id, from_warehouse_id, to_company_id, to_warehouse_id, transfer_date, status, notes, created_by)
                       VALUES ('TR-1026-0001',$1,$2,$1,$3,'2026-10-18','completed','Move to Unit 2',$4) RETURNING id`, [SUN, SUN_MAIN, SUN_U2, U])
await c.query(`INSERT INTO transfer_items (transfer_id, material_type_id, material_size_id, size_label, quantity, unit, item_name, item_master_id, purchase_line_id)
               VALUES ($1,$2,$3,$4,1.2,'MT',$5,$6,$7)`, [tr2.id, MT.GA, GA121.sizeId, GA121.size, GA121.name, GA121.itemId, B1.lines[0]])

// ── Accounts ─────────────────────────────────────────────────────────────
const fe = (type, ref_type, cid, sup, cus, refId, refNo, amt, date, mode, notes) =>
  c.query(`INSERT INTO financial_entries (company_id, supplier_id, customer_id, entry_type, reference_type, reference_id, reference_number, amount, entry_date, payment_mode, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [cid, sup, cus, type, ref_type, refId, refNo, amt, date, mode, notes])
await fe('PAYMENT', 'purchase_bill', SUN, BHARAT, null, B1.id, B1.number, 750000, '2026-08-20', 'Bank Transfer', 'Part payment')
await fe('PAYMENT', 'purchase_bill', SUN, METRO, null, B2.id, B2.number, 1000000, '2026-09-10', 'Bank Transfer', null)
await fe('RECEIPT', 'dispatch_order', SUN, null, NOVA, S1.id, S1.inv, 450000, '2026-09-12', 'UPI', null)
await fe('RECEIPT', 'dispatch_order', SUN, null, PRIME, S3.id, S3.inv, 200000, '2026-10-15', 'Cheque', 'Cheque no. 004512')

// Entries the screenshot script cancels through the app's own APIs, so the
// cancellation archives and Deleted Ledger Rows have something to show.
await bill('2026-11-05', METRO, SUN, SUN_MAIN, [[CR1250, 2.4, 58100]], 'active', 'DEMO-TO-CANCEL: duplicate of MSS-2534')
await sale('2026-11-11', VISTA, SUN, SUN_MAIN, [[HR1250, B6.lines[0], 1.2, 58700]], { notes: 'DEMO-TO-CANCEL: wrong customer' })
const J5 = await jobWork('2026-11-11', '2026-11-20', SLIT, SUN, SUN_MAIN, 'Coil Slitting', [[HR1250, B6.lines[0], 2.0]])
await c.query(`UPDATE job_work_orders SET notes = 'DEMO-TO-CANCEL: sent to wrong vendor' WHERE id = $1`, [J5.id])

const { rows: counts } = await c.query(`SELECT entry_type, count(*)::int n, sum(quantity)::numeric(12,3) q FROM stock_ledger GROUP BY 1 ORDER BY 1`)
console.log('Demo data seeded. Stock ledger:', counts.map((r) => `${r.entry_type}=${r.n}`).join(', '))
console.log('Purchase lines:', [B1, B2, B3, B4, B5, B6].map((b) => b.lines.join('/')).join('  '))
await c.query('COMMIT')
await c.end()
