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

// Real Hasura's run_sql endpoint stringifies every cell, so 'true'/'false'
// string comparison is correct there — but runSqlLocal() (LOCAL_MODE, used
// by automated tests and the desktop build) runs raw SQL via `pg`, which
// returns native booleans for boolean columns. Accept both representations
// so is_valid/reviewed parse correctly in both modes.
function toBool(v: unknown): boolean {
  return v === true || v === 'true'
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
  }
}
