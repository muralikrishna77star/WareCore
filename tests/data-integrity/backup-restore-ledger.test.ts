// Backup restore must reproduce the stock ledger exactly — never post it a
// second time (migration 174). Runs the REAL getAllTableData() and
// restoreFromBackup() through the app's own DB pool against a throwaway
// Postgres: before 174, re-inserting purchase/sale/job work lines fired
// their ledger-posting triggers and every movement was doubled on top of the
// restored stock_ledger rows.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { startTestDb } from '../../scripts/test/testDb.mjs'

type BackupModule = typeof import('@/lib/backup/backup.service')
type PoolModule = typeof import('@/lib/localdb/pool')

let db: Awaited<ReturnType<typeof startTestDb>>
let client: pg.Client
let backup: BackupModule
let pool: PoolModule

beforeAll(async () => {
  db = await startTestDb({})
  client = new pg.Client({ connectionString: db.connectionString })
  await client.connect()
  // The backup service reaches the DB through src/lib/localdb, configured
  // from these at first use — set them before importing it.
  process.env.DATABASE_URL = db.connectionString
  process.env.DIRECT_DB = 'true'
  backup = await import('@/lib/backup/backup.service')
  pool = await import('@/lib/localdb/pool')
}, 300_000)

afterAll(async () => {
  await pool?.closePool()
  await client?.end()
  await db?.stop()
}, 60_000)

const ids: Record<string, string> = {}

/** Every ledger row reduced to what it means, sorted — two equal arrays = identical stock. */
async function ledgerShape() {
  const { rows } = await client.query(
    `SELECT entry_type, reference_type, reference_id::text, purchase_line_id, quantity::text, entry_date::text
     FROM stock_ledger ORDER BY entry_type, reference_id, purchase_line_id, quantity, entry_date`)
  return rows.map((r) => Object.values(r).join('|'))
}

async function derivedState() {
  const { rows: [r] } = await client.query(
    `SELECT (SELECT quantity_received::text FROM job_work_items WHERE id = $1) AS jw_received,
            (SELECT total_quantity::text || '/' || total_amount::text FROM purchase_bills WHERE id = $2) AS bill_totals,
            (SELECT status FROM job_work_orders WHERE id = $3) AS jw_status`,
    [ids.jobWorkItem, ids.bill, ids.jobWork])
  return r
}

describe('Backup restore and the stock ledger (migration 174)', () => {
  it('seeds a purchase, a job work dispatch, a vendor direct sale, a warehouse sale and a customer return', async () => {
    const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0]
    const company = await q(`INSERT INTO companies (name, code) VALUES ('BR', 'BR') RETURNING id`)
    const wh = await q(`INSERT INTO warehouses (company_id, name) VALUES ($1, 'WH') RETURNING id`, [company.id])
    const supplier = await q(`INSERT INTO suppliers (name) VALUES ('BR-SUP') RETURNING id`)
    const vendor = await q(`INSERT INTO suppliers (name) VALUES ('BR-VENDOR') RETURNING id`)
    const customer = await q(`INSERT INTO customers (name) VALUES ('BR-CUST') RETURNING id`)
    const mt = await q(`INSERT INTO material_types (code, description, unit) VALUES ('BR', 'BR', 'MT') RETURNING id`)

    const bill = await q(
      `INSERT INTO purchase_bills (supplier_id, company_id, warehouse_id, bill_number, bill_date, status)
       VALUES ($1, $2, $3, 'BR-BILL-1', '2024-06-01', 'active') RETURNING id`, [supplier.id, company.id, wh.id])
    const billItem = await q(
      `INSERT INTO purchase_bill_items (bill_id, material_type_id, quantity, unit, rate, amount)
       VALUES ($1, $2, 10, 'MT', 100, 1000) RETURNING purchase_line_id`, [bill.id, mt.id])

    const jw = await q(
      `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
       VALUES ('JW-BR-1', $1, $2, $3, '2024-06-05', 'dispatched') RETURNING id`, [vendor.id, company.id, wh.id])
    const jwItem = await q(
      `INSERT INTO job_work_items (purchase_line_id, job_work_order_id, material_type_id, quantity_sent, quantity_received, unit)
       VALUES ($1, $2, $3, 4, 0, 'MT') RETURNING id`, [billItem.purchase_line_id, jw.id, mt.id])

    // Vendor direct sale: posts a virtual return + SALE_OUT and bumps the job line's quantity_received.
    const vds = await q(
      `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status, is_vendor_direct, source_job_work_order_id)
       VALUES ('BR-VDS-1', $1, $2, $3, '2024-06-10', 'active', true, $4) RETURNING id`, [customer.id, company.id, wh.id, jw.id])
    await q(
      `INSERT INTO dispatch_items (dispatch_order_id, material_type_id, quantity, unit, purchase_line_id, source_job_work_item_id)
       VALUES ($1, $2, 1.5, 'MT', $3, $4) RETURNING id`, [vds.id, mt.id, billItem.purchase_line_id, jwItem.id])

    const sale = await q(
      `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status)
       VALUES ('BR-SALE-1', $1, $2, $3, '2024-06-12', 'active') RETURNING id`, [customer.id, company.id, wh.id])
    const saleItem = await q(
      `INSERT INTO dispatch_items (dispatch_order_id, material_type_id, quantity, unit, rate, amount, purchase_line_id)
       VALUES ($1, $2, 2, 'MT', 150, 300, $3) RETURNING id`, [sale.id, mt.id, billItem.purchase_line_id])
    const ret = await q(`SELECT create_sale_return($1, $2, '2024-06-20', NULL, NULL, $3::jsonb, NULL) AS r`,
      [randomUUID(), sale.id, JSON.stringify([{ dispatch_item_id: saleItem.id, quantity: 0.5 }])])
    expect(ret.r.success).toBe(true)

    Object.assign(ids, { bill: bill.id, jobWork: jw.id, jobWorkItem: jwItem.id, sale: sale.id, mt: mt.id, company: company.id, wh: wh.id, customer: customer.id })
    const types = (await client.query(`SELECT DISTINCT entry_type FROM stock_ledger ORDER BY 1`)).rows.map((r) => r.entry_type)
    expect(types).toEqual(['JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'PURCHASE_IN', 'SALE_OUT', 'SALE_RETURN_IN'])
  })

  it('a full restore (delete existing data first) gives back exactly the same ledger — nothing posted twice', async () => {
    const before = await ledgerShape()
    const derivedBefore = await derivedState()
    expect(Number(derivedBefore.jw_received)).toBeCloseTo(1.5, 3)

    const data = await backup.getAllTableData()
    const result = await backup.restoreFromBackup(data, { truncateFirst: true })
    const failures = Object.entries(result.tableResults).filter(([, r]) => r.failed > 0)
    expect(failures).toEqual([])

    expect(await ledgerShape()).toEqual(before)
    expect(await derivedState()).toEqual(derivedBefore)
  })

  it('restoring into an empty database without deleting first (the first-time setup restore) gives back the same ledger', async () => {
    const before = await ledgerShape()
    const derivedBefore = await derivedState()
    const data = await backup.getAllTableData()

    await client.query(`TRUNCATE companies, suppliers, customers, material_types CASCADE`)
    expect(await ledgerShape()).toEqual([])

    const result = await backup.restoreFromBackup(data, { truncateFirst: false })
    expect(Object.entries(result.tableResults).filter(([, r]) => r.failed > 0)).toEqual([])
    expect(await ledgerShape()).toEqual(before)
    expect(await derivedState()).toEqual(derivedBefore)
  })

  it('the restore switch does not leak: a sale entered afterwards on the same pool still posts its stock', async () => {
    const { getPool } = pool
    const p = await getPool()
    // Use every pooled connection once, so a leaked setting would show up.
    await Promise.all(Array.from({ length: 5 }, () => p.query('SELECT 1')))
    const { rows: [order] } = await p.query(
      `INSERT INTO dispatch_orders (invoice_number, customer_id, company_id, warehouse_id, dispatch_date, status)
       VALUES ('BR-SALE-AFTER', $1, $2, $3, '2024-07-01', 'active') RETURNING id`, [ids.customer, ids.company, ids.wh])
    await p.query(`INSERT INTO dispatch_items (dispatch_order_id, material_type_id, quantity, unit) VALUES ($1, $2, 1, 'MT')`, [order.id, ids.mt])
    const { rows } = await client.query(`SELECT quantity::text FROM stock_ledger WHERE reference_id = $1 AND entry_type = 'SALE_OUT'`, [order.id])
    expect(rows).toEqual([{ quantity: '-1.000' }])
  })

  it('a restore WITHOUT the stock ledger still lets the documents post their stock', async () => {
    const data = await backup.getAllTableData()
    delete data.stock_ledger
    const result = await backup.restoreFromBackup(data, { truncateFirst: true })
    expect(Object.values(result.tableResults).filter((r) => r.failed > 0)).toEqual([])
    const { rows } = await client.query(`SELECT entry_type, count(*)::int AS n FROM stock_ledger GROUP BY 1 ORDER BY 1`)
    // Posted by the document triggers. A customer return is only ever posted
    // by create_sale_return(), so it can't be rebuilt without the ledger.
    expect(rows.map((r) => r.entry_type)).toEqual(['JOB_WORK_OUT', 'JOB_WORK_RETURN_IN', 'PURCHASE_IN', 'SALE_OUT'])
  })

  it('the backup list covers every table in the database, parents first', async () => {
    const { BACKUP_TABLES, TABLES_WITHOUT_CREATED_AT } = await import('@/lib/backup/tables')
    const { rows: tables } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 1`)
    expect([...BACKUP_TABLES].sort()).toEqual(tables.map((r) => r.tablename))

    const { rows: noDate } = await client.query(
      `SELECT t.tablename FROM pg_tables t
       WHERE t.schemaname = 'public' AND t.tablename <> 'schema_migrations' AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public' AND c.table_name = t.tablename AND c.column_name = 'created_at')
       ORDER BY 1`)
    expect([...TABLES_WITHOUT_CREATED_AT].sort()).toEqual(noDate.map((r) => r.tablename))

    const { rows: fks } = await client.query(
      `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
       FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid <> c.confrelid`)
    const outOfOrder = fks
      .filter((fk) => BACKUP_TABLES.indexOf(fk.parent) > BACKUP_TABLES.indexOf(fk.child))
      .map((fk) => `${fk.child}->${fk.parent}`)
    expect(outOfOrder).toEqual([])
  })

  describe('job work lines sourced from outputs and from other lines', () => {
    async function seedLinkedLines() {
      const q = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0]
      const vendor = await q(`INSERT INTO suppliers (name) VALUES ('BR-LINK-VENDOR') RETURNING id`)
      const item = await q(
        `INSERT INTO item_master (item_code, item_name, material_type_id) VALUES ('BR-LINK-ITEM', 'BR link item', $1) RETURNING id`, [ids.mt])
      const order = await q(
        `INSERT INTO job_work_orders (reference_number, vendor_id, company_id, warehouse_id, dispatch_date, status)
         VALUES ('JW-BR-LINK', $1, $2, $3, '2024-08-01', 'dispatched') RETURNING id`, [vendor.id, ids.company, ids.wh])
      const first = await q(
        `INSERT INTO job_work_items (job_work_order_id, material_type_id, quantity_sent, quantity_received, unit, purchase_line_id)
         VALUES ($1, $2, 1, 0, 'MT', (SELECT purchase_line_id FROM purchase_bill_items LIMIT 1)) RETURNING id`, [order.id, ids.mt])
      const output = await q(
        `INSERT INTO job_work_output_items (job_work_order_id, item_master_id, material_type_id, quantity, unit, source_job_line_id, received_date)
         VALUES ($1, $2, $3, 0.5, 'MT', 'JL-LINK', '2024-08-05') RETURNING id`, [order.id, item.id, ids.mt])
      const fromOutput = await q(
        `INSERT INTO job_work_items (job_work_order_id, material_type_id, quantity_sent, quantity_received, unit, source_job_work_output_item_id)
         VALUES ($1, $2, 0.25, 0, 'MT', $3) RETURNING id`, [order.id, ids.mt, output.id])
      const fromLine = await q(
        `INSERT INTO job_work_items (job_work_order_id, material_type_id, quantity_sent, quantity_received, unit, purchase_line_id, source_job_work_item_id)
         VALUES ($1, $2, 0.1, 0, 'MT', (SELECT purchase_line_id FROM purchase_bill_items LIMIT 1), $3) RETURNING id`, [order.id, ids.mt, first.id])
      return { output: output.id, fromOutput: fromOutput.id, fromLine: fromLine.id, first: first.id }
    }

    /** Every row of both tables, every column, so any change a restore makes shows up. */
    const snapshot = async () => {
      const lines = await client.query(`SELECT * FROM job_work_items ORDER BY id`)
      const outputs = await client.query(`SELECT * FROM job_work_output_items ORDER BY id`)
      return { lines: lines.rows, outputs: outputs.rows }
    }

    let seeded: Awaited<ReturnType<typeof seedLinkedLines>>

    it('a restore that deletes existing data first keeps every line and output', async () => {
      seeded = await seedLinkedLines()
      const before = await snapshot()
      const ledgerBefore = await ledgerShape()

      const data = await backup.getAllTableData()
      // The child line first, so it can only succeed by being retried after its parent.
      data.job_work_items.sort((a, b) => (a.id === seeded.fromLine ? -1 : b.id === seeded.fromLine ? 1 : 0))
      const result = await backup.restoreFromBackup(data, { truncateFirst: true })

      expect(Object.entries(result.tableResults).filter(([, r]) => r.failed > 0)).toEqual([])
      expect(await snapshot()).toEqual(before)
      expect(before.lines.find((l) => l.id === seeded.fromOutput)?.source_job_work_output_item_id).toBe(seeded.output)
      expect(before.lines.find((l) => l.id === seeded.fromLine)?.source_job_work_item_id).toBe(seeded.first)
      expect(await ledgerShape()).toEqual(ledgerBefore)
    })

    it('a restore into an empty database keeps every line and output', async () => {
      const before = await snapshot()
      const data = await backup.getAllTableData()
      await client.query(`TRUNCATE companies, suppliers, customers, material_types CASCADE`)

      const result = await backup.restoreFromBackup(data, { truncateFirst: false })

      expect(Object.entries(result.tableResults).filter(([, r]) => r.failed > 0)).toEqual([])
      expect(await snapshot()).toEqual(before)
    })

    it('a full backup restored over itself changes no row in any table', async () => {
      const read = async () => {
        const data = await backup.getAllTableData()
        return Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.map((r) => JSON.stringify(r)).sort()]))
      }
      const before = await read()
      const result = await backup.restoreFromBackup(await backup.getAllTableData(), { truncateFirst: true })
      expect(Object.entries(result.tableResults).filter(([, r]) => r.failed > 0)).toEqual([])
      expect(await read()).toEqual(before)
    })

    it('a row that can never be restored is reported, and the rest still go in', async () => {
      const data = await backup.getAllTableData()
      const template = data.job_work_items.find((l) => l.id === seeded.fromLine)!
      const orphan = { ...template, id: randomUUID(), job_line_id: null, source_job_work_item_id: randomUUID() }
      const good = { ...template, id: randomUUID(), job_line_id: null, source_job_work_item_id: seeded.first }
      const result = await backup.restoreFromBackup({ job_work_items: [orphan, good] }, { truncateFirst: false })
      expect(result.tableResults.job_work_items.restored).toBe(1)
      expect(result.tableResults.job_work_items.failed).toBe(1)
      expect(result.tableResults.job_work_items.sampleErrors[0]).toMatch(/foreign key/i)
    })
  })


  it('the Backup route streams every table and records the backup once it has finished', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      verifySessionCookie: async () => ({ role: 'admin', email: 'backup-test@example.com' }),
    }))
    const { POST } = await import('@/app/api/backup/create/route')
    const { BACKUP_TABLES } = await import('@/lib/backup/tables')
    const request = (body: unknown) => new Request('http://test/api/backup/create', { method: 'POST', body: JSON.stringify(body) })

    const res = await POST(request({ tables: BACKUP_TABLES, name: 'Full' }) as never)
    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(Object.keys(payload.data)).toEqual(BACKUP_TABLES)
    expect(payload.backup.tables).toEqual(BACKUP_TABLES)
    const counted = Object.values(payload.data as Record<string, unknown[]>).reduce((sum, rows) => sum + rows.length, 0)
    expect(payload.backup.totalRows).toBe(counted)

    const listed = (await backup.listBackups()).find((b) => b.id === payload.backup.id)
    expect(listed?.tables).toEqual(BACKUP_TABLES)

    // A name that isn't on the list never reaches SQL.
    const partial = await (await POST(request({ tables: ['companies', 'item_groups', 'companies; DROP TABLE companies'] }) as never)).json()
    expect(Object.keys(partial.data)).toEqual(['companies'])
    vi.doUnmock('@/lib/auth/session')
  })

  it('every ledger-posting insert trigger carries the restore guard', async () => {
    const { rows } = await client.query(`
      SELECT t.tgrelid::regclass::text || '.' || t.tgname AS name, pg_get_triggerdef(t.oid) LIKE '%warecore.restoring%' AS guarded
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND t.tgtype & 4 <> 0 AND t.tgtype & 2 = 0      -- AFTER INSERT
        AND p.prosrc ~* '(insert into|update)\\s+(public\\.)?[a-z_]+'          -- writes other rows
      ORDER BY 1`)
    expect(rows.filter((r) => !r.guarded).map((r) => r.name)).toEqual([])
    expect(rows.length).toBeGreaterThanOrEqual(6)
  })
})
