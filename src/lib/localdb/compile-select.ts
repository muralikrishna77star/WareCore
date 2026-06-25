import { FieldNode } from 'graphql'
import { getPool } from './pool'
import { buildWhere } from './where'
import { RELATIONSHIPS } from './relationships'
import { evalArgs, fieldSelections, resultKey } from './ast'

type Row = Record<string, unknown>

function buildOrderBy(orderBy: unknown): string {
  if (!orderBy) return ''
  const list = Array.isArray(orderBy) ? orderBy : [orderBy]
  const parts = list.flatMap((o) =>
    Object.entries(o as Record<string, string>).map(([col, dir]) => `"${col}" ${String(dir).toUpperCase()}`)
  )
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : ''
}

function formatScalar(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  return value
}

export async function shapeRow(table: string, row: Row, field: FieldNode, variables: Record<string, unknown>): Promise<Row> {
  const out: Row = {}
  for (const sub of fieldSelections(field.selectionSet)) {
    const key = sub.name.value
    const alias = resultKey(sub)
    const rel = RELATIONSHIPS[table]?.[key]

    if (!rel) {
      out[alias] = formatScalar(row[key])
      continue
    }

    const pool = getPool()
    if (rel.kind === 'object') {
      const fk = row[rel.localKey]
      if (fk === null || fk === undefined) {
        out[alias] = null
        continue
      }
      const res = await pool.query(`SELECT * FROM "${rel.table}" WHERE id = $1 LIMIT 1`, [fk])
      out[alias] = res.rows[0] ? await shapeRow(rel.table, res.rows[0], sub, variables) : null
    } else {
      const childArgs = evalArgs(sub, variables)
      const orderSql = buildOrderBy(childArgs.order_by)
      const limitSql = childArgs.limit != null ? ` LIMIT ${Number(childArgs.limit)}` : ''
      const res = await pool.query(
        `SELECT * FROM "${rel.table}" WHERE "${rel.foreignKey}" = $1${orderSql}${limitSql}`,
        [row.id]
      )
      out[alias] = await Promise.all(res.rows.map((r) => shapeRow(rel.table, r, sub, variables)))
    }
  }
  return out
}

export async function selectMany(table: string, args: Record<string, unknown>, field: FieldNode, variables: Record<string, unknown>) {
  const params: unknown[] = []
  const whereSql = buildWhere(table, args.where, params)
  const distinctOn = args.distinct_on as string[] | undefined
  const distinctSql = distinctOn?.length ? `DISTINCT ON (${distinctOn.map((c) => `"${c}"`).join(', ')}) ` : ''
  let orderSql = buildOrderBy(args.order_by)
  if (distinctOn?.length && !orderSql) {
    orderSql = ` ORDER BY ${distinctOn.map((c) => `"${c}"`).join(', ')}`
  }
  const limitSql = args.limit != null ? ` LIMIT ${Number(args.limit)}` : ''

  const pool = getPool()
  const res = await pool.query(
    `SELECT ${distinctSql}* FROM "${table}" WHERE ${whereSql}${orderSql}${limitSql}`,
    params
  )
  return Promise.all(res.rows.map((r) => shapeRow(table, r, field, variables)))
}

export async function selectByPk(table: string, args: Record<string, unknown>, field: FieldNode, variables: Record<string, unknown>) {
  const pool = getPool()
  const res = await pool.query(`SELECT * FROM "${table}" WHERE id = $1 LIMIT 1`, [args.id])
  return res.rows[0] ? shapeRow(table, res.rows[0], field, variables) : null
}

export async function selectAggregate(table: string, args: Record<string, unknown>, field: FieldNode) {
  const aggregateField = fieldSelections(field.selectionSet).find((f) => f.name.value === 'aggregate')
  const wantCount = !!aggregateField && fieldSelections(aggregateField.selectionSet).some((f) => f.name.value === 'count')
  const sumField = aggregateField && fieldSelections(aggregateField.selectionSet).find((f) => f.name.value === 'sum')
  const sumCols = sumField ? fieldSelections(sumField.selectionSet).map((f) => f.name.value) : []

  const selectParts: string[] = []
  if (wantCount) selectParts.push('COUNT(*) AS __count')
  for (const col of sumCols) selectParts.push(`SUM("${col}") AS "__sum_${col}"`)
  if (selectParts.length === 0) selectParts.push('COUNT(*) AS __count')

  const params: unknown[] = []
  const whereSql = buildWhere(table, args.where, params)
  const pool = getPool()
  const res = await pool.query(`SELECT ${selectParts.join(', ')} FROM "${table}" WHERE ${whereSql}`, params)
  const row = res.rows[0] ?? {}

  const aggregate: Row = {}
  if (wantCount) aggregate.count = Number(row.__count ?? 0)
  if (sumCols.length) {
    aggregate.sum = Object.fromEntries(
      sumCols.map((col) => [col, row[`__sum_${col}`] != null ? Number(row[`__sum_${col}`]) : null])
    )
  }
  return { aggregate }
}
