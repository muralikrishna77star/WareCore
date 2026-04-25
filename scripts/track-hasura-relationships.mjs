/**
 * Tracks all FK relationships in Hasura via the Metadata API.
 * Run: node scripts/track-hasura-relationships.mjs
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load env
const envPath = resolve(process.cwd(), '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] })
)

const HASURA_URL = (env.NEXT_PUBLIC_HASURA_URL || '').replace('/v1/graphql', '')
const ADMIN_SECRET = env.HASURA_ADMIN_SECRET

if (!HASURA_URL || !ADMIN_SECRET) {
  console.error('Missing HASURA_URL or HASURA_ADMIN_SECRET in .env.local')
  process.exit(1)
}

const METADATA_URL = `${HASURA_URL}/v1/metadata`

// Helper to build object relationship using FK column
function objRel(table, name, fkColumn) {
  return {
    type: 'pg_create_object_relationship',
    args: {
      source: 'warecore',
      table: { schema: 'public', name: table },
      name,
      using: { foreign_key_constraint_on: fkColumn }
    }
  }
}

// Helper to build object relationship using manual column mapping
function objRelManual(table, name, remoteTable, columnMapping) {
  return {
    type: 'pg_create_object_relationship',
    args: {
      source: 'warecore',
      table: { schema: 'public', name: table },
      name,
      using: {
        manual_configuration: {
          remote_table: { schema: 'public', name: remoteTable },
          column_mapping: columnMapping
        }
      }
    }
  }
}

// Helper to build array relationship using FK on child table
function arrRel(table, name, childTable, childColumn) {
  return {
    type: 'pg_create_array_relationship',
    args: {
      source: 'warecore',
      table: { schema: 'public', name: table },
      name,
      using: {
        foreign_key_constraint_on: {
          table: { schema: 'public', name: childTable },
          column: childColumn
        }
      }
    }
  }
}

// Tables to track (in dependency order)
const tables = [
  'companies',
  'warehouses',
  'suppliers',
  'customers',
  'material_types',
  'material_sizes',
  'user_profiles',
  'purchase_bills',
  'purchase_bill_items',
  'stock_ledger',
  'transfers',
  'transfer_items',
  'dispatch_orders',
  'dispatch_items',
  'job_work_orders',
  'job_work_items',
]

async function trackTable(tableName) {
  try {
    const res = await fetch(METADATA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': ADMIN_SECRET
      },
      body: JSON.stringify({
        type: 'pg_track_table',
        args: {
          source: 'warecore',
          table: { schema: 'public', name: tableName }
        }
      })
    })
    const data = await res.json()
    if (data.code === 'already-tracked' || data.message?.includes('already tracked')) {
      console.log(`  ⚠  ${tableName} — already tracked (skipped)`)
    } else if (data.code || data.error) {
      console.error(`  ✗  ${tableName} — ${data.error || data.code}: ${data.message || ''}`)
    } else {
      console.log(`  ✓  ${tableName}`)
    }
  } catch (err) {
    console.error(`  ✗  ${tableName} — network error: ${err.message}`)
  }
}

console.log(`\nStep 1: Tracking ${tables.length} tables...\n`)
for (const t of tables) {
  await trackTable(t)
}

const relationships = [
  // ── warehouses ──────────────────────────────────────────
  objRel('warehouses', 'companies', 'company_id'),

  // ── material_sizes ───────────────────────────────────────
  objRel('material_sizes', 'material_types', 'material_type_id'),
  arrRel('material_types', 'material_sizes', 'material_sizes', 'material_type_id'),

  // ── user_profiles ────────────────────────────────────────
  objRel('user_profiles', 'companies', 'company_id'),
  objRel('user_profiles', 'warehouses', 'warehouse_id'),

  // ── purchase_bills ───────────────────────────────────────
  objRel('purchase_bills', 'companies', 'company_id'),
  objRel('purchase_bills', 'warehouses', 'warehouse_id'),
  objRel('purchase_bills', 'suppliers', 'supplier_id'),
  arrRel('purchase_bills', 'purchase_bill_items', 'purchase_bill_items', 'bill_id'),

  // ── purchase_bill_items ──────────────────────────────────
  objRel('purchase_bill_items', 'material_types', 'material_type_id'),
  objRel('purchase_bill_items', 'material_sizes', 'material_size_id'),
  objRel('purchase_bill_items', 'purchase_bills', 'bill_id'),

  // ── stock_ledger ─────────────────────────────────────────
  objRel('stock_ledger', 'companies', 'company_id'),
  objRel('stock_ledger', 'warehouses', 'warehouse_id'),
  objRel('stock_ledger', 'material_types', 'material_type_id'),
  objRel('stock_ledger', 'material_sizes', 'material_size_id'),

  // ── transfers (manual config — two FKs to same tables) ──
  objRelManual('transfers', 'companies_from', 'companies', { from_company_id: 'id' }),
  objRelManual('transfers', 'companies_to',   'companies', { to_company_id: 'id' }),
  objRelManual('transfers', 'warehouses_from', 'warehouses', { from_warehouse_id: 'id' }),
  objRelManual('transfers', 'warehouses_to',   'warehouses', { to_warehouse_id: 'id' }),
  arrRel('transfers', 'transfer_items', 'transfer_items', 'transfer_id'),

  // ── transfer_items ───────────────────────────────────────
  objRel('transfer_items', 'material_types', 'material_type_id'),
  objRel('transfer_items', 'material_sizes', 'material_size_id'),
  objRel('transfer_items', 'transfers', 'transfer_id'),

  // ── dispatch_orders ──────────────────────────────────────
  objRel('dispatch_orders', 'companies',  'company_id'),
  objRel('dispatch_orders', 'warehouses', 'warehouse_id'),
  objRel('dispatch_orders', 'customers',  'customer_id'),
  arrRel('dispatch_orders', 'dispatch_items', 'dispatch_items', 'dispatch_order_id'),

  // ── dispatch_items ───────────────────────────────────────
  objRel('dispatch_items', 'material_types', 'material_type_id'),
  objRel('dispatch_items', 'material_sizes', 'material_size_id'),
  objRel('dispatch_items', 'dispatch_orders', 'dispatch_order_id'),

  // ── job_work_orders ──────────────────────────────────────
  objRel('job_work_orders', 'suppliers', 'vendor_id'),   // vendor_id FK → suppliers
  objRel('job_work_orders', 'companies', 'company_id'),
  objRel('job_work_orders', 'warehouses', 'warehouse_id'),
  arrRel('job_work_orders', 'job_work_items', 'job_work_items', 'job_work_order_id'),

  // ── job_work_items ───────────────────────────────────────
  objRel('job_work_items', 'material_types', 'material_type_id'),
  objRel('job_work_items', 'material_sizes', 'material_size_id'),
  objRel('job_work_items', 'job_work_orders', 'job_work_order_id'),
]

async function trackRelationship(op) {
  const table = op.args.table.name
  const name = op.args.name
  try {
    const res = await fetch(METADATA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': ADMIN_SECRET
      },
      body: JSON.stringify(op)
    })
    const data = await res.json()
    if (data.code === 'already-exists' || data.message?.includes('already exists')) {
      console.log(`  ⚠  ${table}.${name} — already exists (skipped)`)
    } else if (data.code || data.error) {
      console.error(`  ✗  ${table}.${name} — ${data.error || data.code}: ${data.message || ''}`)
    } else {
      console.log(`  ✓  ${table}.${name}`)
    }
  } catch (err) {
    console.error(`  ✗  ${table}.${name} — network error: ${err.message}`)
  }
}

console.log(`\nStep 2: Tracking ${relationships.length} relationships...\n`)

for (const op of relationships) {
  await trackRelationship(op)
}

console.log('\nDone. Restart your Next.js dev server if it is running.\n')
