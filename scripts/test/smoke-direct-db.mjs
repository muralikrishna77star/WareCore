#!/usr/bin/env node
// Read-only smoke test of the direct-Postgres GraphQL engine (src/lib/localdb)
// against a real database: runs EVERY query document in src/ (mutations are
// skipped — nothing is written) with variables filled from real rows, and
// reports any that error, plus the slowest ones.
//
// Usage: node --env-file=.env.local scripts/test/smoke-direct-db.mjs
// Needs DATABASE_URL. Safe to run against production: SELECTs only.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(root, 'package.json'))
const { parse, Kind, print } = require('graphql')
const { Client } = require('pg')
const jiti = require('jiti')(join(root, 'package.json'), { alias: { '@': join(root, 'src') } })
const { executeGraphQL } = jiti(join(root, 'src', 'lib', 'localdb', 'executor.ts'))
const { closePool } = jiti(join(root, 'src', 'lib', 'localdb', 'pool.ts'))
// --compare-old: also run each query through a copy of an older engine in
// scripts/test/.old-localdb and diff the results (order-insensitive).
const compareOld = process.argv.includes('--compare-old')
const old = compareOld ? jiti(join(root, 'scripts', 'test', '.old-localdb', 'executor.ts')) : null
const oldPool = compareOld ? jiti(join(root, 'scripts', 'test', '.old-localdb', 'pool.ts')) : null
const canon = (v) => Array.isArray(v) ? v.map(canon).map((x) => JSON.stringify(x)).sort().map((x) => JSON.parse(x))
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
const mismatches = []
const skipped = []

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1) }
const db = new Client({ connectionString: process.env.DATABASE_URL })
await db.connect()

const idCache = new Map()
async function anyId(table) {
  if (idCache.has(table)) return idCache.get(table)
  let id = null
  try { id = (await db.query(`SELECT id FROM "${table}" ORDER BY created_at DESC NULLS LAST LIMIT 1`)).rows[0]?.id ?? null } catch {
    try { id = (await db.query(`SELECT id FROM "${table}" LIMIT 1`)).rows[0]?.id ?? null } catch { /* no id column */ }
  }
  idCache.set(table, id)
  return id
}

const NAME_TABLE = [
  [/company/i, 'companies'], [/warehouse/i, 'warehouses'], [/supplier|vendor/i, 'suppliers'], [/customer/i, 'customers'],
  [/materialType|material_type/i, 'material_types'], [/materialSize|material_size/i, 'material_sizes'],
  [/itemMaster|item_master|itemId/i, 'item_master'], [/purchaseLine|billItem|purchase_line/i, 'purchase_bill_items'],
  [/bill/i, 'purchase_bills'], [/dispatch|sale/i, 'dispatch_orders'], [/transfer/i, 'job_work_transfers'],
  [/jobWork|job_work|order/i, 'job_work_orders'], [/user|createdBy/i, 'user_profiles'], [/conversation/i, 'ai_conversations'],
  [/exception/i, 'di_exceptions'], [/batch/i, 'purchase_import_batches'], [/group/i, 'item_groups'],
]

function tableOf(rootField) {
  return rootField.replace(/_by_pk$/, '').replace(/_aggregate$/, '')
}

function namedType(t) { return t.kind === Kind.NAMED_TYPE ? t.name.value : namedType(t.type) }
function isList(t) { return t.kind === Kind.LIST_TYPE || (t.kind === Kind.NON_NULL_TYPE && isList(t.type)) }

async function fillVar(name, typeNode, rootTable) {
  const t = namedType(typeNode)
  let v
  if (/_bool_exp$/.test(t)) v = {}
  else if (/_order_by$/.test(t)) return undefined
  else if (t === 'uuid' || t === 'ID') {
    const hinted = NAME_TABLE.find(([re]) => re.test(name))?.[1]
    v = (name === 'id' ? await anyId(rootTable) : null) ?? (hinted ? await anyId(hinted) : null) ?? (await anyId(rootTable)) ?? '00000000-0000-0000-0000-000000000000'
  } else if (t === 'date' || t === 'timestamptz' || t === 'timestamp') v = /from|start|since|after|min|open/i.test(name) ? '2024-04-01' : '2026-12-31'
  else if (t === 'Int' || t === 'bigint') v = /limit/i.test(name) ? 50 : 1
  else if (t === 'numeric' || t === 'Float') v = 1
  else if (t === 'Boolean') v = true
  else if (t === 'String') {
    if (/email/i.test(name)) v = (await db.query('SELECT email FROM user_profiles LIMIT 1')).rows[0]?.email ?? 'x@example.invalid'
    else if (/date|from|to/i.test(name)) v = /from|start/i.test(name) ? '2024-04-01' : '2026-12-31'
    else if (/status/i.test(name)) v = 'active'
    else v = 'x'
  } else v = null
  return isList(typeNode) ? (v == null ? [] : [v]) : v
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'localdb' ? [] : filesUnder(p)
    return /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

const failures = []
const timings = []
let ran = 0
const seen = new Set()
for (const file of filesUnder(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/`\s*(query\b[\s\S]*?)`/g)) {
    if (/\$\{/.test(m[1])) continue
    let doc
    try { doc = parse(m[1]) } catch { continue }
    const op = doc.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION)
    if (!op || op.operation !== 'query') continue
    const key = print(op)
    if (seen.has(key)) continue
    seen.add(key)
    const firstRoot = op.selectionSet.selections.find((s) => s.kind === Kind.FIELD)
    const rootTable = tableOf(firstRoot?.name.value ?? '')
    const variables = {}
    for (const vd of op.variableDefinitions ?? []) {
      const v = await fillVar(vd.variable.name.value, vd.type, rootTable)
      if (v !== undefined) variables[vd.variable.name.value] = v
    }
    const label = `${op.name?.value ?? '(anon)'} — ${file.slice(root.length + 1)}`
    const t0 = Date.now()
    const res = await executeGraphQL(m[1], variables)
    const ms = Date.now() - t0
    ran++
    timings.push([ms, label])
    if (res.errors) failures.push(`${label}\n      ${res.errors[0].message}\n      vars ${JSON.stringify(variables).slice(0, 200)}`)
  }
}

await closePool()
if (oldPool) await oldPool.closePool()
if (compareOld) {
  console.log(`
Compared with old engine: ${mismatches.length} mismatch(es), ${skipped.length} skipped`)
  for (const x of mismatches) console.log('  MISMATCH ' + x)
  for (const x of skipped) console.log('  skipped  ' + x)
}
await db.end()
console.log(`Ran ${ran} distinct query documents.`)
console.log('\nSlowest 10:')
for (const [ms, label] of timings.sort((a, b) => b[0] - a[0]).slice(0, 10)) console.log(`  ${String(ms).padStart(6)} ms  ${label}`)
if (failures.length) {
  console.log(`\n${failures.length} FAILED:`)
  for (const f of failures) console.log('  ' + f)
  process.exit(1)
}
console.log('\nAll queries ran without errors.')
