import { FieldNode } from 'graphql'
import { getPool } from './pool'
import { shapeRow } from './compile-select'

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
