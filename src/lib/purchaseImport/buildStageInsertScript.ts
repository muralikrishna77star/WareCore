// Builds the atomic INSERT script for creating a batch + all its staging
// rows in one go — same rationale as buildInsertScript.ts (pulled out of
// the route so it's independently testable; ids are app-generated so no
// RETURNING clause is ever needed; relies on Postgres's simple-query-
// protocol implicit transaction for a multi-statement string).
import { sqlUuidOrNull, sqlTextOrNull } from '@/lib/dataIntegrity/sqlSafe'
import { sqlNumber } from './buildInsertScript'
import { sqlJsonb } from './db'
import type { ParsedRow } from './types'
import type { RowResolutionResult } from './resolve'

export interface StagedRowInput {
  rowNumber: number
  parsedRow: ParsedRow
  resolution: RowResolutionResult
}

export interface StageBatchInput {
  id: string
  fileName: string
  fileHash: string
  fileSizeBytes: number
  rowCount: number
  createdBy: string | null
  duplicateOfBatchId?: string | null
}

export function buildStageInsertScript(batch: StageBatchInput, rows: StagedRowInput[]): string {
  const batchSql = `
    INSERT INTO purchase_import_batches (id, file_name, file_hash, file_size_bytes, row_count, created_by, duplicate_of_batch_id)
    VALUES (
      ${sqlUuidOrNull(batch.id)}, ${sqlTextOrNull(batch.fileName)}, ${sqlTextOrNull(batch.fileHash)},
      ${sqlNumber(batch.fileSizeBytes)}, ${sqlNumber(batch.rowCount)}, ${sqlUuidOrNull(batch.createdBy)},
      ${sqlUuidOrNull(batch.duplicateOfBatchId ?? null)}
    );
  `

  const rowValues = rows
    .map((r) => `(
      ${sqlUuidOrNull(batch.id)}, ${sqlNumber(r.rowNumber)}, ${sqlJsonb(r.parsedRow)}, ${sqlJsonb(r.parsedRow)},
      ${sqlJsonb(r.resolution.resolved)}, ${sqlJsonb(r.resolution.errors)}, ${r.resolution.isValid}
    )`)
    .join(',\n    ')

  const rowsSql = `
    INSERT INTO purchase_import_rows (batch_id, row_number, raw_data, current_data, resolved_field_ids, validation_errors, is_valid)
    VALUES
    ${rowValues};
  `

  return `${batchSql}\n${rowsSql}`
}
