// Shared helpers for reading purchase_import_batches/purchase_import_rows
// via hasuraRunSql() — every cell comes back as a string (see
// src/lib/hasura/server.ts), so JSONB columns need explicit JSON.parse and
// booleans need explicit 'true'/'false' string comparison (see
// r.is_enabled === 'true' precedent in
// src/app/(app)/data-integrity/rules/page.tsx).
import type { ParsedRow, RowError } from './types'
import type { RowResolutionResult } from './resolve'

export function rowsToObjects(result: { result: string[][] }): Record<string, string>[] {
  const [columns, ...rows] = result.result
  return rows.map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])))
}

export function sqlJsonb(value: unknown): string {
  return `'${JSON.stringify(value ?? null).replace(/'/g, "''")}'::jsonb`
}

export function sqlBool(v: boolean): string {
  return v ? 'true' : 'false'
}

// Real Hasura's run_sql endpoint stringifies every cell using Postgres's own
// text output format for booleans, which is 't'/'f' — NOT the JS-style
// 'true'/'false' string this file's precedent assumed (verified directly
// against production: `SELECT is_valid FROM purchase_import_rows` comes
// back as "t"/"f"). That earlier assumption meant is_valid/reviewed always
// parsed to false in production regardless of the real value, which is why
// a fully valid+reviewed batch never showed "ready to import" and a clean
// row displayed "0 errors" instead of "Valid". runSqlLocal() (LOCAL_MODE —
// automated tests and the desktop build) instead returns native booleans
// via `pg`. Accept all three representations.
function toBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 't'
}

// run_sql also returns SQL NULL as the text 'NULL'; LOCAL_MODE returns
// native values (a Date for timestamps).
function textOrNull(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString()
  return typeof v === 'string' && v !== '' && v !== 'NULL' ? v : null
}

export interface StagingRowRecord {
  id: string
  batch_id: string
  row_number: number
  raw_data: ParsedRow
  current_data: ParsedRow
  resolved_field_ids: RowResolutionResult['resolved'] | null
  validation_errors: RowError[]
  is_valid: boolean
  reviewed: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  correction_history: { at: string; by: string | null; changes: Record<string, { old: unknown; new: unknown }> }[]
  created_at: string
  updated_at: string
  purchase_bill_id: string | null
  purchase_bill_number: string | null
  /** Skipped by the user — left out of the import (migration 161). */
  excluded: boolean
  excluded_by: string | null
  excluded_at: string | null
  exclusion_reason: string | null
}

/** Which rows of a staged batch go into the import, and whether it can run. */
export function selectRowsForImport(rows: StagingRowRecord[]) {
  const included = rows.filter((r) => !r.excluded)
  const skipped = rows.filter((r) => r.excluded)
  const notReady = included.filter((r) => !r.is_valid || !r.reviewed)
  return {
    included,
    skipped,
    notReady,
    readyToImport: included.length > 0 && notReady.length === 0,
  }
}

export function parseStagingRow(raw: Record<string, string>): StagingRowRecord {
  return {
    id: raw.id,
    batch_id: raw.batch_id,
    row_number: Number(raw.row_number),
    raw_data: JSON.parse(raw.raw_data),
    current_data: JSON.parse(raw.current_data),
    resolved_field_ids: raw.resolved_field_ids ? JSON.parse(raw.resolved_field_ids) : null,
    validation_errors: JSON.parse(raw.validation_errors ?? '[]'),
    is_valid: toBool(raw.is_valid),
    reviewed: toBool(raw.reviewed),
    reviewed_by: raw.reviewed_by || null,
    reviewed_at: raw.reviewed_at || null,
    correction_history: JSON.parse(raw.correction_history ?? '[]'),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    purchase_bill_id: raw.purchase_bill_id || null,
    purchase_bill_number: raw.purchase_bill_number || null,
    excluded: toBool(raw.excluded),
    excluded_by: textOrNull(raw.excluded_by),
    excluded_at: textOrNull(raw.excluded_at),
    exclusion_reason: textOrNull(raw.exclusion_reason),
  }
}
