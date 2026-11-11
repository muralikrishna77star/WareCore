import { FieldNode } from 'graphql'
import { getGraphqlPool } from './pool'
import { fieldSelections, resultKey } from './ast'
import { shapeRow, shapeRows } from './compile-select'

interface OnConflict {
  constraint: string
  update_columns?: string[]
}

function buildOnConflict(onConflict: OnConflict | undefined): string {
  if (!onConflict) return ''
  if (!onConflict.update_columns?.length) {
    return ` ON CONFLICT ON CONSTRAINT "${onConflict.constraint}" DO NOTHING`
  }
  const setSql = onConflict.update_columns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
  return ` ON CONFLICT ON CONSTRAINT "${onConflict.constraint}" DO UPDATE SET ${setSql}`
}

export async function insertOne(table: string, args: Record<string, unknown>, field: FieldNode, variables: Record<string, unknown>) {
  const object = args.object as Record<string, unknown>
  const cols = Object.keys(object)
  const values = cols.map((c) => object[c])
  const placeholders = values.map((_, i) => `$${i + 1}`)
  const onConflictSql = buildOnConflict(args.on_conflict as OnConflict | undefined)

  const pool = getGraphqlPool()
  const res = await pool.query(
    `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})${onConflictSql} RETURNING *`,
    values
  )
  return res.rows[0] ? shapeRow(table, res.rows[0], field, variables) : null
}

export async function insertMany(table: string, args: Record<string, unknown>, field: FieldNode, variables: Record<string, unknown>) {
  const objects = args.objects as Record<string, unknown>[]
  if (!objects?.length) return buildResult(field, 0, [])

  // Columns = union over ALL objects (Hasura allows objects with different
  // keys). A column an object leaves out gets the column DEFAULT, as in
  // Hasura — not NULL, which would break e.g. a defaulted id or created_at.
  const cols = [...new Set(objects.flatMap((o) => Object.keys(o)))]
  const params: unknown[] = []
  const rowsSql = objects.map((obj) => {
    const placeholders = cols.map((c) => {
      if (!(c in obj) || obj[c] === undefined) return 'DEFAULT'
      params.push(obj[c])
      return `$${params.length}`
    })
    return `(${placeholders.join(', ')})`
  })
  const onConflictSql = buildOnConflict(args.on_conflict as OnConflict | undefined)

  const pool = getGraphqlPool()
  const res = await pool.query(
    `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${rowsSql.join(', ')}${onConflictSql} RETURNING *`,
    params
  )

  const returningField = fieldSelections(field.selectionSet).find((f) => f.name.value === 'returning')
  const returning = returningField
    ? await shapeRows(table, res.rows, returningField, variables)
    : []

  return buildResult(field, res.rowCount ?? res.rows.length, returning)
}

function buildResult(field: FieldNode, affectedRows: number, returning: unknown[]) {
  const out: Record<string, unknown> = {}
  for (const sub of fieldSelections(field.selectionSet)) {
    if (sub.name.value === 'affected_rows') out[resultKey(sub)] = affectedRows
    if (sub.name.value === 'returning') out[resultKey(sub)] = returning
  }
  return out
}
