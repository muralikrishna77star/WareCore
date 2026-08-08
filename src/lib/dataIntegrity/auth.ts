// Role gates for the Data Integrity module, per the assignment's §9:
//  - developer/admin: run full checks, manage rules, approve repairs.
//  - company_manager: run/view checks, read-only otherwise.
//  - billing_staff: read-only (matches its existing access to
//    /api/stock/verify — see CURRENT_STATE_AUDIT.md §6).
//  - repair approval/execution: admin/developer only (enforced again here
//    even though repair execution has no implementation in Phase 1, so the
//    gate is already correct when execution is added).
export const CAN_VIEW = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])
export const CAN_RUN_SCAN = new Set(['admin', 'developer', 'company_manager'])
export const CAN_MANAGE_RULES = new Set(['admin', 'developer'])
export const CAN_PROPOSE_REPAIR = new Set(['admin', 'developer'])
export const CAN_APPROVE_REPAIR = new Set(['admin', 'developer'])

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
