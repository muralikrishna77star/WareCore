import { getPool } from './pool'

/**
 * Drop-in replacement for hasuraRunSql() in LOCAL_MODE — runs raw SQL directly
 * against local Postgres via `pg` instead of Hasura's /v2/query endpoint.
 * Shapes the result the same way callers already consume it: a header row
 * followed by data rows. jsonb/object columns are stringified (callers like
 * the job-work delete route JSON.parse() the cell), matching how Hasura's
 * run_sql endpoint returns jsonb as text.
 */
export async function runSqlLocal(sql: string): Promise<{ result: unknown[][] }> {
  const pool = getPool()
  const res = await pool.query(sql)
  const fields = res.fields.map((f) => f.name)
  const rows = res.rows.map((row) =>
    fields.map((f) => {
      const v = row[f]
      if (v === null || v === undefined) return null
      if (v instanceof Date) return v.toISOString()
      if (typeof v === 'object') return JSON.stringify(v)
      return v
    })
  )
  return { result: [fields, ...rows] }
}
