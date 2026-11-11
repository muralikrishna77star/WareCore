import { FieldNode } from 'graphql'
import { getGraphqlPool } from './pool'
import { buildWhere } from './where'
import { RELATIONSHIPS } from './relationships'
import { evalArgs, fieldSelections, resultKey } from './ast'

type Row = Record<string, unknown>

// `table` is required to resolve relationship-qualified order_by, e.g.
// `order_by: { job_work_transfer: { transfer_date: desc } }` — sorts by a
// related row's column via a correlated subquery, since the related table
// isn't joined into the main FROM clause.
function buildOrderBy(table: string, orderBy: unknown): string {
  if (!orderBy) return ''
  const list = Array.isArray(orderBy) ? orderBy : [orderBy]
  const parts = list.flatMap((o) =>
    Object.entries(o as Record<string, unknown>).map(([key, dir]) => {
      if (dir !== null && typeof dir === 'object') {
        const rel = RELATIONSHIPS[table]?.[key]
        if (!rel || rel.kind !== 'object') {
          throw new Error(`Unsupported relationship order_by "${key}" on table "${table}"`)
        }
        const [[relCol, relDir]] = Object.entries(dir as Record<string, string>)
        return `(SELECT "${relCol}" FROM "${rel.table}" WHERE id = "${table}"."${rel.localKey}") ${orderDirection(relDir)}`
      }
      return `"${table}"."${key}" ${orderDirection(dir)}`
    })
  )
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : ''
}

// Hasura's order_by enum → SQL. Hasura's plain asc/desc put NULLs last for
// asc and first for desc, which is also Postgres' default.
function orderDirection(dir: unknown): string {
  switch (String(dir)) {
    case 'asc': return 'ASC'
    case 'desc': return 'DESC'
    case 'asc_nulls_first': return 'ASC NULLS FIRST'
    case 'asc_nulls_last': return 'ASC NULLS LAST'
    case 'desc_nulls_first': return 'DESC NULLS FIRST'
    case 'desc_nulls_last': return 'DESC NULLS LAST'
    default: throw new Error(`Unsupported order_by direction "${String(dir)}"`)
  }
}

function formatScalar(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  return value
}

/**
 * Shapes many rows of one table to a selection set. Each relationship in the
 * selection is loaded with ONE query for all the rows together (id = ANY(...)),
 * not one query per row — the per-row version was fine against the desktop's
 * on-machine Postgres but meant thousands of network round trips per page
 * against a hosted database.
 */
export async function shapeRows(table: string, rows: Row[], field: FieldNode, variables: Record<string, unknown>): Promise<Row[]> {
  const out: Row[] = rows.map(() => ({}))
  if (rows.length === 0) return out
  const pool = getGraphqlPool()

  for (const sub of fieldSelections(field.selectionSet)) {
    const key = sub.name.value
    const alias = resultKey(sub)
    const rel = RELATIONSHIPS[table]?.[key]

    if (!rel) {
      rows.forEach((row, i) => { out[i][alias] = formatScalar(row[key]) })
      continue
    }

    if (rel.kind === 'object') {
      const ids = [...new Set(rows.map((r) => r[rel.localKey]).filter((v) => v !== null && v !== undefined))]
      const byId = new Map<unknown, Row>()
      if (ids.length) {
        const res = await pool.query(`SELECT * FROM "${rel.table}" WHERE id = ANY($1)`, [ids])
        const shaped = await shapeRows(rel.table, res.rows, sub, variables)
        res.rows.forEach((r, i) => byId.set(String(r.id), shaped[i]))
      }
      rows.forEach((row, i) => {
        const fk = row[rel.localKey]
        out[i][alias] = fk === null || fk === undefined ? null : byId.get(String(fk)) ?? null
      })
      continue
    }

    // Array relationship: all children of all parents in one query, then
    // grouped per parent (keeping the ORDER BY) with any limit applied per parent.
    const childArgs = evalArgs(sub, variables)
    const parentIds = [...new Set(rows.map((r) => r.id).filter((v) => v !== null && v !== undefined))]
    const groups = new Map<string, Row[]>()
    if (parentIds.length) {
      const params: unknown[] = [parentIds]
      const whereSql = buildWhere(rel.table, childArgs.where, params)
      const orderSql = buildOrderBy(rel.table, childArgs.order_by)
      const res = await pool.query(
        `SELECT * FROM "${rel.table}" WHERE "${rel.table}"."${rel.foreignKey}" = ANY($1) AND ${whereSql}${orderSql}`,
        params
      )
      const limit = childArgs.limit != null ? Number(childArgs.limit) : Infinity
      const kept: Row[] = []
      for (const r of res.rows) {
        const k = String(r[rel.foreignKey])
        const g = groups.get(k) ?? []
        if (g.length < limit) {
          g.push(r)
          kept.push(r)
        }
        groups.set(k, g)
      }
      const shaped = await shapeRows(rel.table, kept, sub, variables)
      const shapedOf = new Map(kept.map((r, i) => [r, shaped[i]]))
      for (const [k, g] of groups) groups.set(k, g.map((r) => shapedOf.get(r)!))
    }
    rows.forEach((row, i) => { out[i][alias] = groups.get(String(row.id)) ?? [] })
  }
  return out
}

export async function shapeRow(table: string, row: Row, field: FieldNode, variables: Record<string, unknown>): Promise<Row> {
  const [shaped] = await shapeRows(table, [row], field, variables)
  return shaped
}

export async function selectMany(table: string, args: Record<string, unknown>, field: FieldNode, variables: Record<string, unknown>) {
  const params: unknown[] = []
  const whereSql = buildWhere(table, args.where, params)
  const distinctOn = args.distinct_on as string[] | string | undefined
  const distinctCols = distinctOn == null ? [] : Array.isArray(distinctOn) ? distinctOn : [distinctOn]
  const distinctSql = distinctCols.length ? `DISTINCT ON (${distinctCols.map((c) => `"${c}"`).join(', ')}) ` : ''
  let orderSql = buildOrderBy(table, args.order_by)
  if (distinctCols.length && !orderSql) {
    orderSql = ` ORDER BY ${distinctCols.map((c) => `"${c}"`).join(', ')}`
  }
  const limitSql = args.limit != null ? ` LIMIT ${Number(args.limit)}` : ''
  const offsetSql = args.offset != null ? ` OFFSET ${Number(args.offset)}` : ''

  const pool = getGraphqlPool()
  const res = await pool.query(
    `SELECT ${distinctSql}* FROM "${table}" WHERE ${whereSql}${orderSql}${limitSql}${offsetSql}`,
    params
  )
  return shapeRows(table, res.rows, field, variables)
}

export async function selectByPk(table: string, args: Record<string, unknown>, field: FieldNode, variables: Record<string, unknown>) {
  const pool = getGraphqlPool()
  const res = await pool.query(`SELECT * FROM "${table}" WHERE id = $1 LIMIT 1`, [args.id])
  return res.rows[0] ? shapeRow(table, res.rows[0], field, variables) : null
}

const AGGREGATE_FNS = ['sum', 'max', 'min', 'avg'] as const

export async function selectAggregate(table: string, args: Record<string, unknown>, field: FieldNode) {
  const aggregateField = fieldSelections(field.selectionSet).find((f) => f.name.value === 'aggregate')
  const aggSelections = aggregateField ? fieldSelections(aggregateField.selectionSet) : []
  const wantCount = aggSelections.some((f) => f.name.value === 'count')
  const fnCols = AGGREGATE_FNS.map((fn) => {
    const f = aggSelections.find((s) => s.name.value === fn)
    return { fn, cols: f ? fieldSelections(f.selectionSet).map((c) => c.name.value) : [] }
  }).filter((x) => x.cols.length)

  const selectParts: string[] = []
  if (wantCount) selectParts.push('COUNT(*) AS __count')
  for (const { fn, cols } of fnCols) {
    for (const col of cols) selectParts.push(`${fn.toUpperCase()}("${col}") AS "__${fn}_${col}"`)
  }
  if (selectParts.length === 0) selectParts.push('COUNT(*) AS __count')

  const params: unknown[] = []
  const whereSql = buildWhere(table, args.where, params)
  const pool = getGraphqlPool()
  const res = await pool.query(`SELECT ${selectParts.join(', ')} FROM "${table}" WHERE ${whereSql}`, params)
  const row = res.rows[0] ?? {}

  const aggregate: Row = {}
  if (wantCount) aggregate.count = Number(row.__count ?? 0)
  for (const { fn, cols } of fnCols) {
    // sum/avg are numbers in Hasura; max/min keep the column's own type
    // (a date stays 'YYYY-MM-DD' text) — the pool's type parsers already
    // give each result column the right JS type.
    aggregate[fn] = Object.fromEntries(
      cols.map((col) => {
        const v = row[`__${fn}_${col}`]
        if (v === null || v === undefined) return [col, null]
        return [col, fn === 'sum' || fn === 'avg' ? Number(v) : formatScalar(v)]
      })
    )
  }
  return { aggregate }
}
