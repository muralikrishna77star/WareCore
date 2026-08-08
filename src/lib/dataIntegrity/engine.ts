// Orchestrates one reconciliation run: creates the run row, executes every
// enabled + implemented rule's Postgres function, upserts candidates into
// reconciliation_exceptions keyed by fingerprint (so a repeat scan updates
// an existing open exception instead of duplicating it — REOPENED if it had
// been RESOLVED, but IGNORED is sticky and never auto-reopens, since it
// means a human already confirmed the pattern isn't a defect), auto-closes
// exceptions no longer detected by a full, unscoped scan (see
// autoResolveSql), and closes out the run row with final counts.
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
      -- IGNORED means a human reviewed this exact pattern and confirmed
      -- it's not a defect (e.g. an intentional cross-company/cross-
      -- warehouse stock split) — it's sticky and must never flip back on
      -- its own just because the rule keeps detecting the same,
      -- still-true-by-design pattern every scan. Only RESOLVED (something
      -- was actually fixed) reopens automatically if the same fingerprint
      -- reappears, since that's a real regression worth surfacing again.
      -- Found via a real IGNORED REC-005 exception silently flipping back
      -- to REOPENED on the very next scan.
      status = CASE WHEN reconciliation_exceptions.status = 'RESOLVED' THEN 'REOPENED' ELSE reconciliation_exceptions.status END,
      updated_at = NOW();
  `
}

// Auto-closes exceptions that were OPEN/REOPENED for a rule but weren't
// re-detected by this run (their fingerprint didn't appear in this run's
// upserts, so their run_id is still whatever it was before). Only safe
// when the run actually checked "everywhere" for that rule — a
// company-scoped or date-limited run not finding something proves nothing
// about the rest of the data, so this only fires for scope_type = 'FULL'
// with no company restriction. Never touches IGNORED exceptions (those are
// sticky, see upsertSql). Found necessary the same session REC-018's fix
// via REC-009 left 5 exceptions stuck OPEN with no mechanism to ever close
// them short of a human doing it by hand.
function autoResolveSql(ruleCode: ImplementedRuleCode, runIdLiteral: string): string {
  return `
    UPDATE reconciliation_exceptions e
    SET status = 'RESOLVED',
        resolved_at = NOW(),
        run_id = ${runIdLiteral},
        resolution_notes = COALESCE(e.resolution_notes || ' | ', '') || 'Auto-resolved: no longer detected by a full scan (run ' || ${runIdLiteral}::text || ').'
    FROM reconciliation_rules r
    WHERE r.id = e.rule_id AND r.rule_code = '${ruleCode}'
      AND e.status IN ('OPEN', 'REOPENED', 'ACKNOWLEDGED', 'INVESTIGATING')
      AND e.run_id IS DISTINCT FROM ${runIdLiteral};
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

  // Only a true full-history, all-companies run can safely conclude "not
  // re-detected" means "no longer applies" — see autoResolveSql's comment.
  const autoResolves = scope.scopeType === 'FULL' && !scope.companyId
    ? ruleCodes.map((code) => autoResolveSql(code, runIdLiteral)).join('\n')
    : ''

  // "found" (exceptions_found/critical/high/medium/low counts) means rows
  // this run detected/re-detected — auto-resolved rows share this run's
  // run_id too (see autoResolveSql) but were CLOSED, not found, so they're
  // explicitly excluded from every count below except resolved_count.
  const notAutoResolved = `NOT (status = 'RESOLVED' AND resolution_notes LIKE 'Auto-resolved:%')`
  const closeRunSql = `
    UPDATE reconciliation_runs SET
      status = CASE WHEN (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND ${notAutoResolved}) > 0
                     THEN 'COMPLETED_WITH_EXCEPTIONS' ELSE 'COMPLETED' END,
      completed_at = NOW(),
      execution_time_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000,
      records_scanned = (SELECT COUNT(*) FROM stock_ledger WHERE entry_date BETWEEN ${fromSql} AND ${toSql}
                          AND (${companySql}::uuid IS NULL OR company_id = ${companySql}::uuid)),
      exceptions_found = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND ${notAutoResolved}),
      critical_count = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND ${notAutoResolved} AND severity = 'CRITICAL'),
      high_count = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND ${notAutoResolved} AND severity = 'HIGH'),
      medium_count = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND ${notAutoResolved} AND severity = 'MEDIUM'),
      low_count = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND ${notAutoResolved} AND severity IN ('LOW', 'INFO')),
      resolved_count = (SELECT COUNT(*) FROM reconciliation_exceptions WHERE run_id = ${runIdLiteral} AND status = 'RESOLVED' AND resolution_notes LIKE 'Auto-resolved:%')
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
    const script = `${upserts}\n${autoResolves}\n${closeRunSql}`
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
