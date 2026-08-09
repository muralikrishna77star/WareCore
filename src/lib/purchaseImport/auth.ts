// Role gate for the purchase import staging workflow — same set
// /api/bills/[id]/submit and the original one-shot import routes used.
// Centralized here since 7+ routes under src/app/api/bills/import/batches
// all reuse it (precedent: src/lib/dataIntegrity/auth.ts).
export const ALLOWED_ROLES = new Set(['admin', 'developer', 'company_manager', 'billing_staff'])
