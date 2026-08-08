#!/usr/bin/env node
// Stage B shadow test (docs/data-integrity/ROLLOUT_PLAN.md) — pulls a
// minimized, READ-ONLY snapshot of production via the same
// getAllTableData()/hasuraRunSql() path the app's own backup/export
// feature already uses (src/lib/backup/backup.service.ts), loads it into a
// fresh throwaway embedded Postgres (never production), and runs every
// implemented reconciliation rule against it.
//
// Safety:
//  - Every production query is a plain SELECT, sent with Hasura's
//    read_only: true flag (an extra enforcement layer, not just "we only
//    wrote SELECTs").
//  - Column lists are minimized to what reconciliation actually needs —
//    no password_hash, no contact/PII columns (phone/email/address/gstin),
//    no free-text notes, no pricing. See COLUMNS below per table.
//  - The pulled snapshot lives only in this process's memory. Nothing is
//    written to disk, nothing is committed, nothing leaves this machine.
//  - Historical rows are loaded into the throwaway DB with
//    `session_replication_role = replica`, so INSERTing old
//    purchase_bill_items/dispatch_items/job_work_items/transfer_items rows
//    does NOT re-fire fn_bill_item_to_ledger() etc. and double-post new
//    stock_ledger rows on top of the real historical ones also being
//    loaded, and does NOT regenerate purchase_line_id via
//    trg_generate_purchase_line_id (the real historical value is loaded
//    verbatim).
//  - Nothing is ever written back to production. The throwaway database is
//    destroyed at the end of the run regardless of outcome.
//
// Usage: node --env-file=.env.local scripts/data-integrity/stage-b-shadow-scan.mjs

import pg from 'pg'
import { startTestDb } from '../test/testDb.mjs'

const endpoint = (process.env.HASURA_ENDPOINT || (process.env.NEXT_PUBLIC_HASURA_URL || '').replace('/v1/graphql', ''))
const adminSecret = process.env.HASURA_ADMIN_SECRET

if (!endpoint || !adminSecret) {
  console.error('Missing HASURA_ENDPOINT/NEXT_PUBLIC_HASURA_URL or HASURA_ADMIN_SECRET — run with --env-file=.env.local')
  process.exit(1)
}

async function runProdSql(sql) {
  const res = await fetch(new URL('/v2/query', endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': adminSecret },
    body: JSON.stringify({ type: 'run_sql', args: { source: 'warecore', sql, cascade: false, read_only: true } }),
  })
  const json = await res.json()
  if (!res.ok || json.error) {
    throw new Error(json.error || json.internal?.error?.message || `production query failed: ${sql.slice(0, 80)}...`)
  }
  return json.result
}

function toObjects(result) {
  if (!result || result.length < 2) return []
  const headers = result[0]
  return result.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])))
}

// Minimized column lists — structural/quantity/date data only, no PII, no
// pricing, no free text, no credentials. Order matters (FK dependency).
const TABLES = [
  { name: 'companies', columns: ['id', 'name', 'code', 'is_active'] },
  { name: 'warehouses', columns: ['id', 'company_id', 'name', 'is_active'] },
  { name: 'suppliers', columns: ['id', 'name', 'is_active'] },
  { name: 'customers', columns: ['id', 'name', 'is_active'] },
  { name: 'material_types', columns: ['id', 'code', 'description', 'unit', 'is_active'] },
  { name: 'material_sizes', columns: ['id', 'material_type_id', 'size_label', 'thickness', 'width', 'is_active'] },
  { name: 'purchase_bills', columns: ['id', 'supplier_id', 'company_id', 'warehouse_id', 'bill_number', 'bill_date', 'status', 'cancelled_at'] },
  { name: 'purchase_bill_items', columns: ['id', 'bill_id', 'material_type_id', 'material_size_id', 'size_label', 'quantity', 'unit', 'purchase_line_id', 'created_at'] },
  { name: 'transfers', columns: ['id', 'reference_number', 'from_company_id', 'from_warehouse_id', 'to_company_id', 'to_warehouse_id', 'transfer_date', 'status'] },
  { name: 'transfer_items', columns: ['id', 'transfer_id', 'material_type_id', 'material_size_id', 'size_label', 'quantity', 'unit'] },
  { name: 'job_work_orders', columns: ['id', 'reference_number', 'vendor_id', 'company_id', 'warehouse_id', 'dispatch_date', 'expected_return_date', 'actual_return_date', 'status'] },
  { name: 'job_work_items', columns: ['id', 'job_work_order_id', 'material_type_id', 'material_size_id', 'size_label', 'quantity_sent', 'quantity_received', 'quantity_transferred_out', 'unit', 'is_transfer_line', 'purchase_line_id', 'sub_purchase_line_id'] },
  { name: 'dispatch_orders', columns: ['id', 'invoice_number', 'customer_id', 'company_id', 'warehouse_id', 'dispatch_date', 'status', 'is_vendor_direct', 'source_job_work_order_id'] },
  { name: 'dispatch_items', columns: ['id', 'dispatch_order_id', 'material_type_id', 'material_size_id', 'size_label', 'quantity', 'unit', 'purchase_line_id', 'sub_purchase_line_id'] },
  { name: 'purchase_cancellations', columns: ['id', 'original_bill_id', 'bill_number', 'bill_date', 'company_id', 'warehouse_id', 'supplier_id', 'total_quantity', 'cancelled_at'] },
  { name: 'dispatch_cancellations', columns: ['id', 'original_order_id', 'invoice_number', 'dispatch_date', 'company_id', 'warehouse_id', 'customer_id', 'total_quantity', 'cancelled_at'] },
  { name: 'job_work_cancellations', columns: ['id', 'original_order_id', 'reference_number', 'vendor_id', 'company_id', 'warehouse_id', 'cancelled_at'] },
  { name: 'stock_ledger', columns: ['id', 'entry_type', 'company_id', 'warehouse_id', 'material_type_id', 'material_size_id', 'size_label', 'quantity', 'reference_type', 'reference_id', 'reference_number', 'entry_date', 'created_at', 'purchase_line_id', 'sub_purchase_line_id'] },
]

function sqlLiteral(v) {
  // Hasura's run_sql endpoint returns SQL NULL as the literal string "NULL",
  // not JSON null (same quirk documented in backup.service.ts's restore path).
  if (v === null || v === undefined || v === 'NULL') return 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return String(v)
  return `'${String(v).replace(/'/g, "''")}'`
}

async function main() {
  console.log('=== Stage B shadow test ===')
  console.log('Pulling minimized, read-only snapshot from production...')
  const snapshot = {}
  let totalRows = 0
  for (const t of TABLES) {
    const sql = `SELECT ${t.columns.map((c) => `"${c}"`).join(', ')} FROM ${t.name}`
    const result = await runProdSql(sql)
    snapshot[t.name] = toObjects(result)
    totalRows += snapshot[t.name].length
    console.log(`  ${t.name}: ${snapshot[t.name].length} rows`)
  }
  console.log(`Total: ${totalRows} rows across ${TABLES.length} tables. Nothing written to disk.`)

  console.log('\nStarting throwaway Postgres and applying schema...')
  const db = await startTestDb({ log: () => {} })
  console.log(`Schema ready: ${db.migrationResult.appliedCount} migrations applied, ${db.migrationResult.skippedCount} skipped (production-data-only repairs).`)

  const client = new pg.Client({ connectionString: db.connectionString })
  await client.connect()

  try {
    console.log('\nLoading snapshot with triggers disabled (historical replay, not new events)...')
    await client.query('SET session_replication_role = replica')
    for (const t of TABLES) {
      const rows = snapshot[t.name]
      if (!rows.length) continue
      const cols = t.columns
      const batchSize = 500
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        const values = batch
          .map((row) => `(${cols.map((c) => sqlLiteral(row[c])).join(', ')})`)
          .join(', ')
        await client.query(
          `INSERT INTO ${t.name} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${values} ON CONFLICT DO NOTHING`
        )
      }
      console.log(`  loaded ${t.name}: ${rows.length} rows`)
    }
    await client.query('SET session_replication_role = DEFAULT')

    console.log('\nRunning every implemented rule (full history, all companies)...')
    const rules = [
      'rec_001', 'rec_002', 'rec_003', 'rec_005', 'rec_007',
      'rec_008', 'rec_009', 'rec_013', 'rec_014', 'rec_018',
    ]
    const findings = {}
    for (const rule of rules) {
      const { rows } = await client.query(
        `SELECT severity, count(*) AS n FROM fn_reconcile_${rule}(NULL, '2000-01-01', CURRENT_DATE) GROUP BY severity`
      )
      findings[rule.toUpperCase().replace('_', '-')] = rows
    }

    console.log('\n=== Findings (real production data, read-only scan) ===')
    let totalFindings = 0
    for (const [rule, rows] of Object.entries(findings)) {
      const total = rows.reduce((s, r) => s + Number(r.n), 0)
      totalFindings += total
      if (total === 0) {
        console.log(`  ${rule}: none`)
      } else {
        console.log(`  ${rule}: ${total} (${rows.map((r) => `${r.severity}:${r.n}`).join(', ')})`)
      }
    }
    console.log(`\nTotal exceptions found: ${totalFindings}`)

    return findings
  } finally {
    await client.end()
    await db.stop()
    console.log('\nThrowaway database destroyed. No production data persisted anywhere.')
  }
}

main().catch((err) => {
  console.error('Stage B shadow scan failed:', err)
  process.exit(1)
})
