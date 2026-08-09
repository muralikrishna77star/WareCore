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
    is_valid: raw.is_valid === 'true',
    reviewed: raw.reviewed === 'true',
    reviewed_by: raw.reviewed_by || null,
    reviewed_at: raw.reviewed_at || null,
    correction_history: JSON.parse(raw.correction_history ?? '[]'),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  }
}
