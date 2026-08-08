// Orchestrates one reconciliation run: creates the run row, executes every
// enabled + implemented rule's Postgres function, upserts candidates into
// reconciliation_exceptions keyed by fingerprint (so a repeat scan updates
// an existing open exception instead of duplicating it — REOPENED if it had
// been RESOLVED/IGNORED), and closes out the run row with final counts.
//
// All accounting math happens in the fn_reconcile_rec_XXX() SQL functions
// (088_data_integrity_rule_functions.sql) — this file only decides which
// rules to run and stitches results into persistent rows. Two round trips
// to the database: one to create the run (need its id first), one big
// BEGIN/COMMIT script for every rule's upsert plus the closing UPDATE.

import { hasuraRunSql } from '@/lib/hasura/server'
import { IMPLEMENTED_RULE_CODES, ruleFunctionName, type ImplementedRuleCode } from './rules'
import { sqlDate, sqlText, sqlUuidOrNull } from './sqlSafe'

export type RunScope = {
  runType: 'MANUAL' | 'INCREMENTAL' | 'NIGHTLY_FULL' | 'POST_TRANSACTION' | 'POST_REPAIR'
  scopeType: 'FULL' | 'COMPANY' | 'WAREHOUSE' | 'ITEM' | 'DOCUMENT' | 'DATE_RANGE' | 'INCREMENTAL_SINCE_LAST'
  companyId?: string | null
  fromDate: string
  toDate: string
  startedBy?: string | null
  ruleCodes?: ImplementedRuleCode[]
}

export type RunResult = {
  runId: string
  runNumber: string
  status: 'COMPLETED' | 'COMPLETED_WITH_EXCEPTIONS' | 'FAILED'
  exceptionsFound: number
  criticalCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  errorMessage?: string
}

function parseRows(result: { result: string[][] }): string[][] {
  return result.result.slice(1)
}

// One shared upsert shape for every rule function — see the
// reconciliation_candidate composite type (088) for the column order every
// fn_reconcile_rec_XXX() returns.
function upsertSql(ruleCode: ImplementedRuleCode, runIdLiteral: string, companySql: string, fromSql: string, toSql: string): string {
  const fn = ruleFunctionName(ruleCode)
  return `
    WITH candidates AS (
      SELECT * FROM ${fn}(${companySql}, ${fromSql}, ${toSql})
    ), rule AS (
      SELECT id FROM reconciliation_rules WHERE rule_code = '${ruleCode}'
    )
    INSERT INTO reconciliation_exceptions (
      run_id, rule_id, fingerprint, severity, company_id, warehouse_id, material_type_id, material_size_id,
      purchase_line_id, source_document_type, source_document_id, source_line_id, reference_number,
      expected_value, actual_value, difference, summary, explanation, suspected_cause, evidence, status
    )
    SELECT ${runIdLiteral}, rule.id, c.fingerprint, c.severity, c.company_id, c.warehouse_id, c.material_type_id, c.material_size_id,
      c.purchase_line_id, c.source_document_type, c.source_document_id, c.source_line_id, c.reference_number,
      c.expected_value, c.actual_value, c.difference, c.summary, c.explanation, c.suspected_cause, c.evidence, 'OPEN'
    FROM candidates c, rule
    ON CONFLICT (fingerprint) DO UPDATE SET
      run_id = EXCLUDED.run_id,
      last_detected_at = NOW(),
      occurrence_count = reconciliation_exceptions.occurrence_count + 1,
      severity = EXCLUDED.severity,
      actual_value = EXCLUDED.actual_value,
      difference = EXCLUDED.difference,
      evidence = EXCLUDED.evidence,
      status = CASE WHEN reconciliation_exceptions.status IN ('RESOLVED', 'IGNORED') THEN 'REOPENED' ELSE reconciliation_exceptions.status END,
      updated_at = NOW();
  `
}

async function enabledImplementedRuleCodes(): Promise<ImplementedRuleCode[]> {
  const result = await hasuraRunSql(`SELECT rule_code FROM reconciliation_rules WHERE is_enabled = TRUE`)
  const enabled = new Set(parseRows(result).map((r) => r[0]))
  return IMPLEMENTED_RULE_CODES.filter((code) => enabled.has(code))
}

export async function runReconciliation(scope: RunScope): Promise<RunResult> {
  // scope.ruleCodes lets a caller explicitly narrow a run (e.g. re-running
  // just REC-001 for one item); with no explicit list, only rules currently
  // marked is_enabled in the catalogue run — disabling a rule via
  // PATCH /api/data-integrity/rules/[id] takes effect on the very next scan.
  const ruleCodes = scope.ruleCodes ?? (await enabledImplementedRuleCodes())
  const companySql = sqlUuidOrNull(scope.companyId)
  const fromSql = sqlDate(scope.fromDate)
  const toSql = sqlDate(scope.toDate)
  const startedBySql = sqlUuidOrNull(scope.startedBy)

  const createRunSql = `
    INSERT INTO reconciliation_runs (run_type, scope_type, scope, status, started_at, started_by, rules_executed)
    VALUES ('${scope.runType}', '${scope.scopeType}',
      jsonb_build_object('company_id', ${companySql}::text, 'from_date', ${fromSql}::text, 'to_date', ${toSql}::text),
      'RUNNING', NOW(), ${startedBySql}, ${ruleCodes.length})
    RETURNING id, run_number;
  `
  const createResult = await hasuraRunSql(createRunSql)
  const [runId, runNumber] = parseRows(createResult)[0]
  const runIdLiteral = `'${runId}'::uuid`

  const upserts = ruleCodes.map((code) => upsertSql(code, runIdLiteral, companySql, fromSql, toSql)).join('\n')

  const closeRunSql = `
    UPDATE reconciliation_runs SET
      status = CASE WHEN (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral}) > 0
                     THEN 'COMPLETED_WITH_EXCEPTIONS' ELSE 'COMPLETED' END,
      completed_at = NOW(),
      execution_time_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
      records_scanned = (SELECT COUNT(*) FROM stock_ledger WHERE entry_date BETWEEN ${fromSql} AND ${toSql}
                          AND (${companySql}::uuid IS NULL OR company_id = ${companySql}::uuid)),
      exceptions_found = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral}),
      critical_count = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND severity = 'CRITICAL'),
      high_count = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND severity = 'HIGH'),
      medium_count = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND severity = 'MEDIUM'),
      low_count = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND severity IN ('LOW', 'INFO'))
    WHERE id = ${runIdLiteral}
    RETURNING status, exceptions_found, critical_count, high_count, medium_count, low_count;
  `

  try {
    // No explicit BEGIN/COMMIT: Postgres's simple query protocol already
    // runs a multi-statement string as one implicit transaction. Adding our
    // own COMMIT as the trailing statement was a real bug — Hasura's
    // run_sql returns only the LAST statement's result, and COMMIT returns
    // none, so the closeRunSql RETURNING data (the entire point of this
    // query) was discarded and `result.result` came back null, crashing
    // parseRows. Found by actually calling the deployed API end-to-end
    // against production, not just the SQL functions directly.
    const script = `${upserts}\n${closeRunSql}`
    const result = await hasuraRunSql(script)
    const rows = parseRows(result)
    const summaryRow = rows[rows.length - 1]
    const [status, exceptionsFound, criticalCount, highCount, mediumCount, lowCount] = summaryRow
    return {
      runId,
      runNumber,
      status: status as RunResult['status'],
      exceptionsFound: Number(exceptionsFound),
      criticalCount: Number(criticalCount),
      highCount: Number(highCount),
      mediumCount: Number(mediumCount),
      lowCount: Number(lowCount),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await hasuraRunSql(
      `UPDATE reconciliation_runs SET status = 'FAILED', completed_at = NOW(), error_message = ${sqlText(message)} WHERE id = ${runIdLiteral};`
    ).catch(() => {})
    return {
      runId,
      runNumber,
      status: 'FAILED',
      exceptionsFound: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      errorMessage: message,
    }
  }
}
