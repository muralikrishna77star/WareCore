// Regression test for parseStagingRow()'s boolean handling. Real Hasura's
// run_sql endpoint stringifies every cell ('true'/'false'), but
// runSqlLocal() (LOCAL_MODE, used by automated tests and the desktop build)
// runs raw SQL via `pg`, which returns native booleans for boolean columns.
// A prior version of parseStagingRow() only checked `=== 'true'`, so
// is_valid/reviewed silently parsed to false whenever the real underlying
// value was `true` under LOCAL_MODE — meaning a corrected, valid row could
// never show as valid, be marked reviewed, or become importable. See
// PATCH /api/bills/import/batches/[id]/rows/[rowId] and
// POST /api/bills/import/batches/[id]/import, which both depend on this.
import { describe, expect, it } from 'vitest'
import { parseStagingRow } from '../../src/lib/purchaseImport/db'

// parseStagingRow() is typed to take Record<string, string> (matching real
// Hasura run_sql, which stringifies every cell), but this test deliberately
// feeds it LOCAL_MODE/runSqlLocal's native-boolean shape too (see comment
// above) — that's a real shape the function must tolerate at runtime even
// though it's outside its declared parameter type, hence the cast below.
function asRawRow(row: Record<string, unknown>): Record<string, string> {
  return row as unknown as Record<string, string>
}

function baseRawRow(overrides: Record<string, unknown>) {
  return {
    id: 'row-1',
    batch_id: 'batch-1',
    row_number: '2',
    raw_data: '{}',
    current_data: '{}',
    resolved_field_ids: null,
    validation_errors: '[]',
    reviewed_by: null,
    reviewed_at: null,
    correction_history: '[]',
    created_at: '2024-04-15T00:00:00.000Z',
    updated_at: '2024-04-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('parseStagingRow boolean parsing', () => {
  it('parses real-Hasura-style string booleans', () => {
    expect(parseStagingRow(asRawRow(baseRawRow({ is_valid: 'true', reviewed: 'true' }))).is_valid).toBe(true)
    expect(parseStagingRow(asRawRow(baseRawRow({ is_valid: 'true', reviewed: 'true' }))).reviewed).toBe(true)
    expect(parseStagingRow(asRawRow(baseRawRow({ is_valid: 'false', reviewed: 'false' }))).is_valid).toBe(false)
    expect(parseStagingRow(asRawRow(baseRawRow({ is_valid: 'false', reviewed: 'false' }))).reviewed).toBe(false)
  })

  it('parses LOCAL_MODE/runSqlLocal-style native booleans', () => {
    expect(parseStagingRow(asRawRow(baseRawRow({ is_valid: true, reviewed: true }))).is_valid).toBe(true)
    expect(parseStagingRow(asRawRow(baseRawRow({ is_valid: true, reviewed: true }))).reviewed).toBe(true)
    expect(parseStagingRow(asRawRow(baseRawRow({ is_valid: false, reviewed: false }))).is_valid).toBe(false)
    expect(parseStagingRow(asRawRow(baseRawRow({ is_valid: false, reviewed: false }))).reviewed).toBe(false)
  })
})
