import { FieldNode } from 'graphql'
import { getPool } from './pool'
import { buildWhere } from './where'
import { fieldSelections, resultKey } from './ast'
import { shapeRow } from './compile-select'

export async function deleteByPk(table: string, args: Record<string, unknown>, field: FieldNode, variables: Record<string, unknown>) {
  const pool = getPool()
  const res = await pool.query(`DELETE FROM "${table}" WHERE id = $1 RETURNING *`, [args.id])
  return res.rows[0] ? shapeRow(table, res.rows[0], field, variables) : null
}

export async function deleteMany(table: string, args: Record<string, unknown>, field: FieldNode) {
  const params: unknown[] = []
  const whereSql = buildWhere(table, args.where, params)
  const pool = getPool()
  const res = await pool.query(`DELETE FROM "${table}" WHERE ${whereSql} RETURNING *`, params)

  const out: Record<string, unknown> = {}
  for (const sub of fieldSelections(field.selectionSet)) {
    if (sub.name.value === 'affected_rows') out[resultKey(sub)] = res.rowCount ?? res.rows.length
  }
  return out
}
