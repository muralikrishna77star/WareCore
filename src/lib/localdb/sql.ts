import { getPool } from './pool'

/**
 * Drop-in replacement for hasuraRunSql() when talking to Postgres directly
 * (desktop LOCAL_MODE, web DIRECT_DB) — runs raw SQL via `pg` instead of
 * Hasura's /v2/query endpoint, shaped exactly like run_sql's response:
 *
 * - a SELECT-like last statement → { result_type: 'TuplesOk', result: [header, ...rows] }
 * - anything else               → { result_type: 'CommandOk', result: null }
 * - every cell is Postgres' text output ('t'/'f', '1.500', json as text),
 *   and SQL NULL is the string 'NULL' — the getPool() type parsers keep
 *   values as raw text; this only maps null.
 *
 * Code across the app compares cells to 't' and 'NULL', so anything less
 * faithful silently breaks those screens.
 */
export async function runSqlLocal(sql: string): Promise<{ result_type: string; result: unknown[][] | null }> {
  const pool = getPool()
  // rowMode 'array' keeps duplicate column names (two "id"s in a join) as
  // separate cells, the way run_sql does — keyed rows would collapse them.
  const queryResult = await pool.query({ text: sql, rowMode: 'array' })
  // node-pg returns an ARRAY of QueryResult (one per statement) for a
  // multi-statement string, a single QueryResult otherwise. run_sql returns
  // just the last statement's result, so take that.
  const res = Array.isArray(queryResult) ? queryResult[queryResult.length - 1] : queryResult
  if (!res.fields?.length) return { result_type: 'CommandOk', result: null }
  const fields = res.fields.map((f) => f.name)
  const rows = (res.rows as unknown[][]).map((row) =>
    row.map((v) => (v === null || v === undefined ? 'NULL' : v))
  )
  return { result_type: 'TuplesOk', result: [fields, ...rows] }
}
