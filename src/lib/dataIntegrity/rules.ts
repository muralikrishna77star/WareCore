// Reconciliation rule registry — the single source of truth mapping a
// rule_code to the Postgres function that implements it. All accounting
// logic lives in the fn_reconcile_rec_XXX() functions themselves
// (supabase/migrations/088_data_integrity_rule_functions.sql); this module
// is pure orchestration, per the assignment's instruction to keep the
// Next.js layer as orchestration/authorization, not the accounting
// authority.

export const IMPLEMENTED_RULE_CODES = [
  'REC-001',
  'REC-002',
  'REC-003',
  'REC-005',
  'REC-007',
  'REC-008',
  'REC-009',
  'REC-013',
  'REC-014',
  'REC-018',
] as const

export type ImplementedRuleCode = (typeof IMPLEMENTED_RULE_CODES)[number]

const RULE_FUNCTION_NAME: Record<ImplementedRuleCode, string> = {
  'REC-001': 'fn_reconcile_rec_001',
  'REC-002': 'fn_reconcile_rec_002',
  'REC-003': 'fn_reconcile_rec_003',
  'REC-005': 'fn_reconcile_rec_005',
  'REC-007': 'fn_reconcile_rec_007',
  'REC-008': 'fn_reconcile_rec_008',
  'REC-009': 'fn_reconcile_rec_009',
  'REC-013': 'fn_reconcile_rec_013',
  'REC-014': 'fn_reconcile_rec_014',
  'REC-018': 'fn_reconcile_rec_018',
}

export function isImplementedRuleCode(code: string): code is ImplementedRuleCode {
  return (IMPLEMENTED_RULE_CODES as readonly string[]).includes(code)
}

export function ruleFunctionName(code: ImplementedRuleCode): string {
  return RULE_FUNCTION_NAME[code]
}
