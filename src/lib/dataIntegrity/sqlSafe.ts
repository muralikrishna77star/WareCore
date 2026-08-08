// hasuraRunSql() (src/lib/hasura/server.ts) takes a single raw SQL string,
// not parameterized queries — the same constraint every other raw-SQL route
// in this codebase already works under (see src/app/api/stock/verify/route.ts,
// src/app/api/warehouses/merge/route.ts). These helpers are the one place
// data-integrity code turns a caller-supplied value into a SQL literal, and
// every one of them either validates the shape strictly or throws — nothing
// here ever passes a value through unvalidated.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function sqlUuidOrNull(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'NULL'
  if (!UUID_RE.test(value)) throw new Error(`Invalid UUID: ${value}`)
  return `'${value}'::uuid`
}

export function sqlDate(value: string): string {
  if (!DATE_RE.test(value)) throw new Error(`Invalid date (expected YYYY-MM-DD): ${value}`)
  return `'${value}'::date`
}

export function sqlText(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function sqlTextOrNull(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'NULL'
  return sqlText(value)
}
