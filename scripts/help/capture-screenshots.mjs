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
  body: JSON.stringify({ email: 'TestUser', password: 'TestPassword' }), redirect: 'manual',
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
    await go(shot.path)
    if (shot.before) await shot.before()
    await sleep(500)
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    const file = join(OUT, `${slug}.jpg`)
    await sharp(Buffer.from(data, 'base64')).jpeg({ quality: 80, mozjpeg: true }).toFile(file)
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
