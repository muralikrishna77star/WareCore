import { FieldNode } from 'graphql'
import { getPool } from './pool'
import { buildWhere } from './where'
import { fieldSelections, resultKey } from './ast'
import { shapeRow } from './compile-select'

export async function updateMany(table: string, args: Record<string, unknown>, field: FieldNode, variables: Record<string, unknown>) {
  const set = args._set as Record<string, unknown>
  const setCols = Object.keys(set)
  if (setCols.length === 0) return { affected_rows: 0, returning: [] }

  const params: unknown[] = []
  const setSql = setCols
    .map((c) => {
      params.push(set[c])
      return `"${c}" = $${params.length}`
    })
    .join(', ')

  const whereSql = buildWhere(table, args.where, params)

  const pool = getPool()
  const res = await pool.query(`UPDATE "${table}" SET ${setSql} WHERE ${whereSql} RETURNING *`, params)

  const out: Record<string, unknown> = {}
  for (const sub of fieldSelections(field.selectionSet)) {
    if (sub.name.value === 'affected_rows') out[resultKey(sub)] = res.rowCount ?? res.rows.length
    if (sub.name.value === 'returning') {
      out[resultKey(sub)] = await Promise.all(res.rows.map((row) => shapeRow(table, row, sub, variables)))
    }
  }
  return out
}

export async function updateByPk(table: string, args: Record<string, unknown>, field: FieldNode, variables: Record<string, unknown>) {
  const pkColumns = args.pk_columns as Record<string, unknown>
  const set = args._set as Record<string, unknown>
  const setCols = Object.keys(set)
  if (setCols.length === 0) return null

  const params: unknown[] = []
  const setSql = setCols
    .map((c) => {
      params.push(set[c])
      return `"${c}" = $${params.length}`
    })
    .join(', ')

  const pkCols = Object.keys(pkColumns)
  const whereSql = pkCols
    .map((c) => {
      params.push(pkColumns[c])
      return `"${c}" = $${params.length}`
    })
    .join(' AND ')

  const pool = getPool()
  const res = await pool.query(`UPDATE "${table}" SET ${setSql} WHERE ${whereSql} RETURNING *`, params)
  return res.rows[0] ? shapeRow(table, res.rows[0], field, variables) : null
}
