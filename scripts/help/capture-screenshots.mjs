#!/usr/bin/env node
// Captures one screenshot per Help article (public/help/screens/<slug>.jpg)
// from a running WareCore that holds the demo data from seed-demo.mjs.
// Drives headless Chrome/Edge over the DevTools protocol — no extra npm
// packages. Also cancels the "DEMO-TO-CANCEL" entries through the app's own
// APIs first, so the cancellation archives have something to show.
//
// Usage:
//   node scripts/help/capture-screenshots.mjs <app url> <postgres connection string> [slug ...]
// e.g. node scripts/help/capture-screenshots.mjs http://127.0.0.1:3299 postgres://...  (all)

import pg from 'pg'
import sharp from 'sharp'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const [BASE, CS, ...only] = process.argv.slice(2)
if (!BASE || !CS) { console.error('Usage: capture-screenshots.mjs <app url> <connection string> [slug ...]'); process.exit(1) }
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'help', 'screens')
mkdirSync(OUT, { recursive: true })
const W = 1440, H = 900
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Look up demo record ids ──────────────────────────────────────────────
const db = new pg.Client({ connectionString: CS })
await db.connect()
const val = async (sql, p = []) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0]
const ID = {
  bill: await val(`SELECT id FROM purchase_bills WHERE notes LIKE 'Supplier invoice BCT/2026/0412%'`),
  billCancel: await val(`SELECT id FROM purchase_bills WHERE notes LIKE 'DEMO-TO-CANCEL%'`),
  saleCancel: await val(`SELECT id FROM dispatch_orders WHERE notes LIKE 'DEMO-TO-CANCEL%'`),
  jwCancel: await val(`SELECT id FROM job_work_orders WHERE notes LIKE 'DEMO-TO-CANCEL%'`),
  jwSlit: await val(`SELECT o.id FROM job_work_orders o JOIN job_work_output_items x ON x.job_work_order_id = o.id JOIN suppliers s ON s.id = o.vendor_id WHERE s.name = 'Precision Slitters' ORDER BY o.dispatch_date LIMIT 1`),
  jwCut: await val(`SELECT o.id FROM job_work_orders o JOIN suppliers s ON s.id = o.vendor_id WHERE s.name = 'Kiran Cutting Works' ORDER BY o.dispatch_date LIMIT 1`),
  jwPending: await val(`SELECT id FROM job_work_orders WHERE dispatch_date = '2026-10-09'`),
  saleWithReturn: await val(`SELECT dispatch_order_id FROM sale_returns ORDER BY return_date LIMIT 1`),
  saleReturnable: await val(`SELECT d.id FROM dispatch_orders d JOIN customers c ON c.id = d.customer_id WHERE c.name = 'Delta Roofing Co' AND d.dispatch_date = '2026-09-05'`),
  item: await val(`SELECT im.id FROM item_master im WHERE im.item_name = 'GA 0.80 X 164'`),
  sun: await val(`SELECT id FROM companies WHERE code = 'SUN'`),
  // For the cancel/reverse guides: records whose confirmation dialog the screenshot opens (never confirmed).
  billCancellable: await val(`SELECT b.id FROM purchase_bills b WHERE b.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM purchase_bill_items i JOIN dispatch_items d ON d.purchase_line_id = i.purchase_line_id WHERE i.bill_id = b.id) ORDER BY b.bill_date DESC LIMIT 1`),
  saleCancellable: await val(`SELECT d.id FROM dispatch_orders d WHERE d.status = 'active' AND NOT d.is_vendor_direct
    AND NOT EXISTS (SELECT 1 FROM sale_returns r WHERE r.dispatch_order_id = d.id) ORDER BY d.dispatch_date DESC LIMIT 1`),
  saleReturn: await val(`SELECT id FROM sale_returns WHERE status = 'active' ORDER BY return_date DESC LIMIT 1`),
}
await db.end()

// ── Sign in and prepare (via the app's own APIs) ─────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  // HELP_LOGIN_* lets a demo copy with a changed password be used (e.g. the Android test site).
  body: JSON.stringify({ email: process.env.HELP_LOGIN_EMAIL || 'TestUser', password: process.env.HELP_LOGIN_PASSWORD || 'TestPassword' }), redirect: 'manual',
})
const setCookie = login.headers.getSetCookie()
if (!login.ok || !setCookie.length) throw new Error(`Sign-in failed: ${login.status} ${await login.text()}`)
const cookies = setCookie.map((c) => c.split(';')[0]).map((kv) => ({ name: kv.slice(0, kv.indexOf('=')), value: kv.slice(kv.indexOf('=') + 1) }))
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
const api = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieHeader }, body: JSON.stringify(body ?? {}) })
  const t = await r.text()
  console.log(`  ${path} → ${r.status} ${t.slice(0, 120)}`)
}
if (!only.length) {
  console.log('Preparing demo state:')
  // Cancelled bills/sales reach the cancellation archives once purged.
  if (ID.billCancel) {
    await api(`/api/bills/${ID.billCancel}/cancel`, { notes: 'Duplicate entry of supplier invoice MSS-2534' })
    await api(`/api/bills/${ID.billCancel}/purge`, {})
  }
  if (ID.saleCancel) {
    await api(`/api/dispatch/${ID.saleCancel}/cancel`, { notes: 'Billed to the wrong customer' })
    await api(`/api/dispatch/${ID.saleCancel}/purge`, {})
  }
  if (ID.jwCancel) await api(`/api/jobwork/${ID.jwCancel}/delete`, { notes: 'Sent to the wrong vendor' })
  await api('/api/data-integrity/runs', { runType: 'MANUAL', scopeType: 'FULL' })
}

// ── QR Tracking demo ─────────────────────────────────────────────────────
// Only when the app was built with NEXT_PUBLIC_TRACKING_ENABLED=true (otherwise
// every tracking route answers 404 and the qr-* shots are skipped). Builds one
// story through the app's own APIs: Sunrise Steels switched on with a Live Date
// of 1 Sep 2026, so the August bills are "old stock".
const tapi = async (path, method = 'GET', body) => {
  const r = await fetch(`${BASE}/api/tracking/${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookieHeader }, body: body ? JSON.stringify(body) : undefined })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`tracking ${path}: ${r.status} ${data.error ?? ''}`)
  return data
}
const trackingOn = (await fetch(`${BASE}/api/tracking/context`, { headers: { Cookie: cookieHeader } })).status !== 404
const QR = trackingOn ? await prepareTracking() : null
if (!trackingOn) console.log('QR tracking is off in this build: qr-* shots skipped (build with NEXT_PUBLIC_TRACKING_ENABLED=true).')

async function prepareTracking() {
  const tdb = new pg.Client({ connectionString: CS })
  await tdb.connect()
  const one = async (sql, p = []) => (await tdb.query(sql, p)).rows[0]
  const yard = (await one(`SELECT id::text FROM warehouses WHERE name = 'Main Yard'`)).id
  const unitBy = async (where, p = []) => one(`SELECT id::text, stock_tracking_id, qr_reference FROM tracking_units WHERE ${where} ORDER BY stock_tracking_id LIMIT 1`, p)
  if (Number((await one(`SELECT count(*)::int AS n FROM tracking_units`)).n) === 0) {
    console.log('Preparing QR tracking demo:')
    await tapi('settings', 'POST', { action: 'set_flag', company_id: ID.sun, warehouse_id: null, enabled: true })
    await tdb.query(`UPDATE tracking_feature_flags SET tracking_start_at = '2026-09-01 00:00+05:30' WHERE company_id = $1 AND warehouse_id IS NULL`, [ID.sun])
    await tapi('settings', 'POST', { action: 'save_printer', company_id: ID.sun, warehouse_id: yard, name: 'Dispatch dock', model: 'Zebra ZD230', dpi: 203, label_width_mm: 100, label_height_mm: 50 })
    for (const [code, name, location_type] of [['A-01', 'Bay A, row 1', 'STORAGE'], ['A-02', 'Bay A, row 2', 'STORAGE'], ['B-01', 'Bay B, coil racks', 'STORAGE'], ['BAY-1', 'Loading bay', 'PICKUP_BAY'], ['HOLD-1', 'Quality hold', 'HOLD']]) {
      await tapi('locations', 'POST', { company_id: ID.sun, warehouse_id: yard, code, name, location_type })
    }
    // New purchases: GA in 4 weighed bundles, CR in 3; the newest HR line is left waiting for labels.
    const { lines } = await tapi('eligible-lines?search=')
    const yardLines = lines.filter((l) => l.warehouse_id === yard)
    // The biggest line of each material, so a small duplicate bill never gets the labels.
    const line = (code) => yardLines.filter((l) => l.item_name?.startsWith(code)).sort((x, y) => Number(y.quantity) - Number(x.quantity))[0]
    const split = (qty, parts) => {
      const total = Math.round(Number(qty) * 1000)
      const offsets = [-50, 20, 110, -80, 0, 0].slice(0, parts)
      const rows = offsets.map((o) => Math.floor(total / parts) + o)
      rows[parts - 1] += total - rows.reduce((a, b) => a + b, 0)
      return rows.map((g) => ({ quantity: (g / 1000).toFixed(3), weight_basis: 'weighed' }))
    }
    const ga = (await tapi('units', 'POST', { purchase_line_id: line('GA').purchase_line_id, bundles: split(line('GA').quantity, 4) })).units
    const cr = (await tapi('units', 'POST', { purchase_line_id: line('CR').purchase_line_id, bundles: split(line('CR').quantity, 3) })).units
    // Old stock: the August HR line, found and weighed as two bundles.
    const old = await one(`SELECT i.purchase_line_id FROM purchase_bill_items i JOIN purchase_bills b ON b.id = i.bill_id
      JOIN item_master im ON im.id = i.item_master_id WHERE b.warehouse_id = $1 AND b.bill_date < '2026-09-01' AND im.item_name LIKE 'HR%' ORDER BY b.bill_date LIMIT 1`, [yard])
    const hr = await tapi('verify', 'POST', { purchase_line_id: old.purchase_line_id, company_id: ID.sun, warehouse_id: yard,
      bundles: [{ quantity: '3.900', weight_basis: 'weighed' }, { quantity: '3.880', weight_basis: 'weighed' }], note: 'Found behind Bay A during the September check' })
    const place = (u, location) => tapi(`units/${u.id}/place`, 'POST', { location })
    // ga[1] is left "not put away" (the CR line was partly sent to job work, so its bundles show a book-stock warning).
    await place(ga[0], 'A-01'); await place(ga[2], 'A-02'); await place(ga[3], 'A-02')
    await place(cr[0], 'B-01'); await place(cr[1], 'B-01'); await place(cr[2], 'A-01')
    await place(hr.units[0], 'A-02'); await place(hr.units[1], 'HOLD-1')
    await tapi(`units/${hr.units[1].id}/status`, 'POST', { to: 'ON_HOLD', reason: 'Edge damage, check before sale' })
    // Customer pickup, ready in the loading bay.
    const nova = await one(`SELECT id::text FROM customers WHERE name = 'Nova Fabricators'`)
    const { pickup } = await tapi('pickups', 'POST', { company_id: ID.sun, warehouse_id: yard, customer_id: nova.id })
    await tapi(`pickups/${pickup.id}`, 'POST', { action: 'add_unit', code: cr[0].qr_reference })
    await tapi(`pickups/${pickup.id}`, 'POST', { action: 'add_unit', code: cr[1].stock_tracking_id })
    await tapi(`pickups/${pickup.id}`, 'POST', { action: 'mark_ready', bay: 'BAY-1' })
    // Job work: two GA bundles sent to the slitter; one goes on to the galvanizer; one slit into two coils.
    const vendor = async (name) => (await one(`SELECT id::text FROM suppliers WHERE name = $1`, [name])).id
    const slit = await vendor('Precision Slitters')
    const sent = (await tapi('dispatches', 'POST', { company_id: ID.sun, warehouse_id: yard, vendor_id: slit, vehicle_number: 'TN-09-BX-4471' })).dispatch
    await tapi(`dispatches/${sent.id}`, 'POST', { action: 'add_unit', code: ga[2].stock_tracking_id })
    await tapi(`dispatches/${sent.id}`, 'POST', { action: 'add_unit', code: ga[3].stock_tracking_id })
    await tapi(`dispatches/${sent.id}`, 'POST', { action: 'send', vehicle_number: 'TN-09-BX-4471' })
    const outItem = await one(`SELECT id::text, size_label FROM item_master WHERE item_name = 'GA 0.80 X 164'`)
    const parentWeight = Math.round(Number(ga[2].quantity) * 1000)
    const a = Math.round((parentWeight - 120) / 2)
    await tapi('outputs', 'POST', {
      company_id: ID.sun, warehouse_id: yard, vendor_id: slit, dispatch_id: sent.id, received_on: new Date().toISOString().slice(0, 10),
      outputs: [a, parentWeight - 120 - a].map((g) => ({ item_master_id: outItem.id, size_label: outItem.size_label, quantity: (g / 1000).toFixed(3), weight_basis: 'weighed', parents: [ga[2].id] })),
      remainders: [{ parent: ga[2].id, quantity: '0.120', weight_basis: 'weighed' }], used_up: [ga[2].id], note: 'Slit to 164 mm',
    })
    // An open dispatch being loaded (for the Job Work Dispatch shot).
    const loading = (await tapi('dispatches', 'POST', { company_id: ID.sun, warehouse_id: yard, vendor_id: await vendor('Kiran Cutting Works') })).dispatch
    await tapi(`dispatches/${loading.id}`, 'POST', { action: 'add_unit', code: hr.units[0].stock_tracking_id })
    // A phone's stock count of A-01: CR bundle 3 not scanned (Not found), an A-02 bundle scanned there (Found elsewhere).
    const user = await one(`SELECT id::text FROM user_profiles WHERE email = 'testuser'`)
    const now = Date.now(), at = (s) => new Date(now + s * 1000).toISOString()
    const countId = randomUUID()
    const act = (action, payload, s) => ({ id: randomUUID(), action, warehouse_id: yard, actor_id: user.id, scanned_at: at(s), payload })
    await tapi('offline/sync', 'POST', { device_id: 'demo-phone-01', actions: [
      act('COUNT_START', { count_id: countId, location: 'A-01' }, 0),
      act('COUNT_SCAN', { count_id: countId, code: ga[0].qr_reference }, 2),
      act('COUNT_SCAN', { count_id: countId, code: hr.units[0].stock_tracking_id }, 4),
      act('COUNT_SUBMIT', { count_id: countId }, 6),
      // Scanned 90 minutes ago without a signal, but the bundle was moved online since: refused.
      act('PLACE', { code: cr[1].stock_tracking_id, location: 'A-02' }, -90 * 60),
    ] })
  }
  const ids = {
    yard,
    pickup: (await one(`SELECT id::text FROM tracking_pickups ORDER BY pickup_no LIMIT 1`))?.id,
    dispatchOpen: (await one(`SELECT id::text FROM tracking_vendor_dispatches WHERE status = 'OPEN' ORDER BY dispatch_no LIMIT 1`))?.id,
    receipt: (await one(`SELECT id::text FROM tracking_output_receipts ORDER BY receipt_no LIMIT 1`))?.id,
    count: (await one(`SELECT id::text FROM tracking_stock_counts ORDER BY count_no LIMIT 1`))?.id,
    inStock: (await unitBy(`lifecycle_status = 'IN_STOCK' AND source_type = 'NEW_PURCHASE' AND current_location_id IS NOT NULL`))?.id,
    notPutAway: (await unitBy(`lifecycle_status = 'LABELLED' AND source_type = 'NEW_PURCHASE'`))?.stock_tracking_id,
  }
  await tdb.end()
  return ids
}

// ── Browser ──────────────────────────────────────────────────────────────
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser',
]
const browserPath = BROWSERS.find((p) => existsSync(p))
if (!browserPath) throw new Error('No Chrome/Edge found')
const profile = mkdtempSync(join(tmpdir(), 'wc-shots-'))
const port = 9300 + Math.floor(Math.random() * 500)
const browser = spawn(browserPath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
], { stdio: 'ignore' })

let wsUrl
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200)
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl } catch { /* not up yet */ }
}
if (!wsUrl) throw new Error('Browser did not start')
const ws = new WebSocket(wsUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let msgId = 0
const pending = new Map()
const listeners = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) rej(new Error(m.error.message))
    else res(m.result)
  }
  else for (const l of listeners) l(m)
})
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })

async function go(path) {
  const loaded = new Promise((r) => { const l = (m) => { if (m.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(l), 1); r() } }; listeners.push(l) })
  await send('Page.navigate', { url: BASE + path })
  await Promise.race([loaded, sleep(30000)])
  // Wait for client-side data loading to settle: no "Loading" text and a stable page for a moment.
  for (let i = 0; i < 40; i++) {
    const busy = await evaluate(`(() => { const t = document.body.innerText; return /Loading|Loading…|Loading\\.\\.\\./.test(t) || !!document.querySelector('.animate-spin, .animate-pulse') })()`)
    if (!busy) break
    await sleep(300)
  }
  await sleep(1200)
}

// Type into a React-controlled input.
const typeInto = (selector, text) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
  const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set
  el.focus(); setter.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const clickText = (text, tag = 'button') => evaluate(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find((b) => b.innerText.trim().includes(${JSON.stringify(text)})); if (!el) return false
  el.click(); return true })()`)
const clickSel = (selector) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true })()`)

// ── Shots: one per Help article that has a screenshot ────────────────────
const yr = 'from=2026-04-01&to=2026-11-13'
const SHOTS = {
  'sign-in': { path: '/login', signedOut: true, before: () => typeInto('input[type="email"], input[name="email"], input[type="text"]', 'TestUser') },
  'dashboard': { path: '/dashboard' },
  'find-a-screen': { path: '/dashboard', before: async () => { await typeInto('input[placeholder="Jump to a page..."]', 'job'); await sleep(400) } },
  'use-help': { path: '/help?from=%2Fdispatch%2Fnew' },
  'ask-copilot': { path: '/dashboard', before: async () => { await clickSel('[aria-label="Ask WareCore Copilot"]'); await sleep(800) } },
  'change-password': { path: '/profile' },
  'admin-panel': { path: '/admin' },
  'add-company': { path: '/admin/companies' },
  'add-warehouse': { path: '/admin/warehouses' },
  'add-supplier': { path: '/admin/suppliers' },
  'add-customer': { path: '/admin/customers' },
  'material-types-sizes': { path: '/admin/sizes' },
  'add-item': { path: '/admin/items' },
  'tax-rates': { path: '/admin/tax-rates' },
  'manage-users': { path: '/admin/users' },
  'roles-permissions': { path: '/admin/roles/new' },
  'create-purchase-bill': { path: '/bills/new' },
  'edit-purchase-bill': { path: `/bills/${ID.bill}` },
  'import-purchase-bills': { path: '/bills/import' },
  'cancel-purchase-bill': { path: `/bills/${ID.billCancellable}`, before: async () => { await clickText('Cancel Bill'); await sleep(600) } },
  'purchase-cancellations': { path: '/purchase-cancellations' },
  'inventory': { path: '/inventory' },
  'stock-movements': { path: '/movements', before: async () => {
    await evaluate(`(() => { const el = document.querySelectorAll('input[type="date"]')[0]; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '2026-08-01'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await clickText('Filter'); await sleep(2500)
  } },
  'create-transfer': { path: '/transfers/new' },
  'transfers-list': { path: '/transfers' },
  'create-job-work': { path: '/jobwork/new' },
  'job-work-returns': { path: `/jobwork/${ID.jwCut}/edit?mode=returns` },
  'edit-job-work': { path: `/jobwork/${ID.jwSlit}/edit` },
  'transfer-job-work': { path: `/jobwork/${ID.jwPending}/transfer` },
  'send-output-to-vendor': { path: `/jobwork/${ID.jwSlit}/output-transfer` },
  'job-work-transfers-list': { path: '/jobwork-transfers' },
  'reverse-job-work-transfer': { path: '/jobwork-transfers', before: async () => { await clickText('Reverse'); await sleep(2500) } },
  'cancel-job-work': { path: `/jobwork/${ID.jwSlit}`, before: async () => { await clickText('Delete Order'); await sleep(600) } },
  'job-work-cancellations': { path: '/jobwork-cancellations' },
  'job-work-orders-list': { path: '/jobwork' },
  'create-sale': { path: '/dispatch/new' },
  'vendor-direct-sale': { path: `/dispatch/vendor-direct/new?jw=${ID.jwCut}` },
  'edit-sale': { path: `/dispatch/${ID.saleWithReturn}` },
  'customer-return': { path: `/dispatch/${ID.saleReturnable}/return`, before: async () => { await clickText('Return everything remaining'); await sleep(300) } },
  'cancel-customer-return': { path: `/sale-returns/${ID.saleReturn}`, before: async () => { await clickText('Cancel Return'); await sleep(600) } },
  'cancel-sale': { path: `/dispatch/${ID.saleCancellable}`, before: async () => { await clickText('Cancel Sale'); await sleep(600) } },
  'sale-cancellations': { path: '/sale-cancellations' },
  'accounts': { path: '/accounts' },
  'reports-overview': { path: '/reports' },
  'stock-statement': { path: `/reports/stock-statement?${yr}` },
  'daywise-stock-statement': { path: `/reports/daywise-stock-statement?year=2026&month=9` },
  'billing-report': { path: `/reports/billing?${yr}` },
  'dispatch-report': { path: `/reports/dispatch?${yr}` },
  'transfers-report': { path: `/reports/transfers?${yr}` },
  'movements-report': { path: `/reports/movements?${yr}` },
  'job-work-report': { path: `/reports/jobwork?${yr}` },
  'vendor-movements': { path: `/reports/vendor-movements?${yr}` },
  'item-ledger': { path: `/reports/item-ledger?item=${ID.item}&${yr}` },
  'day-wise-item-ledger': { path: `/reports/day-wise-item-ledger?${yr}` },
  'purchase-line-ledger': { path: `/reports/purchase-line-ledger?line=GA0826-0001` },
  'fy-traceability': { path: `/reports/fy-traceability?year=2026` },
  'data-integrity-dashboard': { path: '/data-integrity' },
  'exception-workbench': { path: '/data-integrity/exceptions' },
  'stock-reconcile': { path: '/data-integrity/stock-reconcile' },
  'ledger-deletions': { path: '/ledger-deletions' },
  'backup-restore': { path: '/admin/backups' },
  'about': { path: '/admin/about' },
  ...(QR ? qrShots(QR) : {}),
}

// ── QR Tracking shots (need the demo from prepareTracking) ───────────────
// Type a code into a scan box and submit it, as a handheld scanner would.
async function scanInto(id, code) {
  await typeInto(`#${id}`, code)
  await evaluate(`document.getElementById(${JSON.stringify(id)}).form.requestSubmit()`)
  await sleep(1500)
}
const chooseOption = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
const scrollToText = (text, offset = 120) => evaluate(`(() => { const el = [...document.querySelectorAll('h2, h3')].find((h) => h.innerText.trim().startsWith(${JSON.stringify(text)})); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - ${offset}) })()`)

function qrShots(q) {
  return {
    'qr-tracking-setup': { path: '/admin/tracking' },
    'qr-locations': { path: '/tracking/locations' },
    'qr-receive-label': { path: '/tracking/receive', before: async () => {
      await evaluate(`[...document.querySelectorAll('ul button')].find((b) => /HR/.test(b.innerText))?.click()`); await sleep(500)
      await typeInto('input[placeholder="Leave blank for one label"]', '3'); await sleep(400)
    } },
    'qr-put-away': { path: '/tracking/stock', before: () => scanInto('stock-bundle', q.notPutAway) },
    'qr-find-bundle': { path: '/tracking/units' },
    'qr-bundle-actions': { path: `/tracking/units/${q.inStock}`, before: async () => { await scrollToText('Change status', 260); await sleep(300) } },
    'qr-customer-pickup': { path: `/tracking/pickups/${q.pickup}`, before: async () => {
      await evaluate(`(() => { const label = [...document.querySelectorAll('label')].find((l) => l.innerText.startsWith("Customer's WhatsApp number")); const el = label && label.querySelector('input'); if (!el) return
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '98400 12345'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
      await scrollToText('Bundles', 300); await sleep(300)
    } },
    'qr-vendor-dispatch': { path: `/tracking/dispatches/${q.dispatchOpen}` },
    'qr-vendor-stock': { path: '/tracking/vendors', before: async () => { await evaluate(`document.querySelectorAll('details').forEach((d) => { d.open = true })`); await sleep(400) } },
    'qr-job-work-outputs': { path: `/tracking/outputs/${q.receipt}` },
    'qr-old-stock': { path: '/tracking/verify', before: async () => {
      await evaluate(`[...document.querySelectorAll('ul button')].find((b) => /CR/.test(b.innerText))?.click()`); await sleep(500)
      const label = 'Number of bundles found'
      await evaluate(`(() => { const l = [...document.querySelectorAll('label')].find((x) => x.innerText.startsWith(${JSON.stringify(label)})); const el = l && l.querySelector('input'); if (!el) return
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
      await sleep(400)
      await evaluate(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const boxes = [...document.querySelectorAll('label')].filter((l) => /^Bundle [0-9]/.test(l.innerText.trim())).map((l) => l.querySelector('input'))
        ;['0.760', '0.735'].forEach((v, i) => { if (boxes[i]) { set.call(boxes[i], v); boxes[i].dispatchEvent(new Event('input', { bubbles: true })) } }) })()`)
      await sleep(400)
    } },
    'qr-tracking-dashboard': { path: '/tracking/dashboard' },
    'qr-stock-counts': { path: `/tracking/counts/${q.count}` },
    'qr-sync-problems': { path: '/tracking/sync-problems' },
    'qr-tracking-reports': { path: `/reports/tracking/stock-by-location?warehouse_id=${q.yard}` },
    // Two phone screens side by side: scanning with a signal, then a scan saved with no signal.
    'qr-offline-scan': { path: '/offline-scan', capture: async () => {
      const PW = 412, PH = 860
      await send('Emulation.setDeviceMetricsOverride', { width: PW, height: PH, deviceScaleFactor: 1, mobile: true })
      await go('/offline-scan')
      await chooseOption('select[aria-label="Warehouse"]', q.yard); await sleep(2500)
      await scanInto('offline-place', q.notPutAway)
      const online = (await send('Page.captureScreenshot', { format: 'png' })).data
      await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      await sleep(1500)
      await scanInto('offline-place', 'B-01')
      const offline = (await send('Page.captureScreenshot', { format: 'png' })).data
      // Leave while still offline so the saved scan is never sent from this throwaway profile.
      await send('Page.navigate', { url: 'about:blank' }); await sleep(500)
      await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
      const gap = 56, pad = 20
      const phone = async (b64) => sharp(Buffer.from(b64, 'base64')).extend({ top: 2, bottom: 2, left: 2, right: 2, background: '#cbd5e1' }).png().toBuffer()
      return sharp({ create: { width: 2 * (PW + 4) + gap + 2 * pad, height: PH + 4 + 2 * pad, channels: 3, background: '#eef3fb' } })
        .composite([{ input: await phone(online), left: pad, top: pad }, { input: await phone(offline), left: pad + PW + 4 + gap, top: pad }])
        .png().toBuffer()
    } },
  }
}

async function setSignedIn(on) {
  await send('Network.clearBrowserCookies')
  if (on) for (const c of cookies) await send('Network.setCookie', { name: c.name, value: c.value, url: BASE, path: '/' })
}

let signedIn = null
const todo = Object.entries(SHOTS).filter(([slug]) => !only.length || only.includes(slug))
for (const [slug, shot] of todo) {
  const want = !shot.signedOut
  if (signedIn !== want) { await setSignedIn(want); signedIn = want }
  try {
    let png
    if (shot.capture) png = await shot.capture()
    else {
      await go(shot.path)
      if (shot.before) await shot.before()
      await sleep(500)
      png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
    }
    const file = join(OUT, `${slug}.jpg`)
    await sharp(png).jpeg({ quality: 80, mozjpeg: true }).toFile(file)
    const title = await evaluate('document.querySelector("main h1, h1")?.innerText ?? document.title')
    console.log(`✓ ${slug.padEnd(26)} ${shot.path}  [${String(title).slice(0, 60)}]`)
  } catch (err) {
    console.log(`✗ ${slug}: ${err.message}`)
  }
}

ws.close()
browser.kill()
await sleep(500)
try { rmSync(profile, { recursive: true, force: true }) } catch { /* browser may still hold files */ }
