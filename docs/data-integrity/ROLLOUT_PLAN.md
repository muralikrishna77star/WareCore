# Rollout Plan

## Stage A — Development (this release covers this stage)

- Local/throwaway database only — `scripts/test/testDb.mjs` spins up a real,
  isolated embedded Postgres, applies every migration (skipping the 11
  confirmed production-data-only repairs — see `TEST_MATRIX.md`), and tears
  it down. Never touches production.
- Synthetic defect cases seeded directly in tests
  (`tests/data-integrity/rules.test.ts`) — the CR00700 pattern reproduced
  with fresh, non-production UUIDs, plus negative/positive cases for
  REC-001, REC-005, REC-007, REC-008, REC-013, REC-014.
- Automated tests run (`npm test`) — see `TEST_MATRIX.md` for current
  status (13/13 passing at time of writing).
- Canonical layer compared against the real defect's known numbers
  (`-0.460` MT, matching the actual CR00700 outcome after migration 084) —
  not yet compared against every existing report's live output; that
  comparison is Stage A follow-up work, not blocking Stage A itself.

**Rollback**: none needed — nothing in Stage A touches a shared database.

## Stage B — Production-copy shadow test (not yet performed)

- Restore a sanitized/secured production backup into a separate Hasura
  Postgres instance (not the live one — see
  `AI_Handoff.md`/`project_deployment.md`-style memory for how this
  project's backups are normally taken via `/api/backup/*`).
- Run every implemented rule read-only against that copy.
- Review every `CRITICAL`/`HIGH` exception by hand. Given
  `CURRENT_STATE_AUDIT.md` §1's migration history, expect REC-005 (negative
  stock) and REC-001/REC-007 (duplicates/reversal mismatch) to surface real,
  already-known-about historical cases — that's a *validation* of the rules
  working, not a new incident.
- Measure false positives — particularly REC-002's dispatch sub-check
  (order-level, not line-level — see `RULE_CATALOGUE.md`) and REC-013
  (confirm it never fires on a genuinely clean zero-balance item across a
  large real dataset, not just the synthetic test).
- Tune `reconciliation_settings.quantity_tolerance` if `0.001` proves too
  tight/loose against real rounding in the existing data.

**Rollback**: the shadow database is disposable — delete it, nothing to undo.

## Stage C — Production shadow mode (not yet performed)

- Deploy the schema (migrations 085–088), the API routes, and the UI to
  production.
- **Repair execution stays disabled** (`reconciliation_settings.repair_execution_enabled = FALSE`,
  unchanged from its migration default — nothing in this release can flip
  it anyway, since no execution code exists).
- Run scheduled read-only scans (manual, via `/data-integrity/runs`, until a
  real scheduler is wired up — see `OPERATIONS_RUNBOOK.md`'s note on
  scheduling; this repo has no cron infrastructure today, per
  `CURRENT_STATE_AUDIT.md` §8).
- Do not alter any ledger data during this stage, including via the legacy
  `/reports/stock-reconcile` "Run Reconciliation" button — Stage C is purely
  about validating detection at production scale.

**Rollback**: drop the 8 new tables (085) and 2 new functions/3 views (087,
088) — none of them are referenced by any existing table/trigger/view, so
this is a clean, isolated rollback. A rollback migration is trivial to write
if ever needed (`DROP TABLE ... CASCADE` in dependency order: exception_rows,
repair_audit_rows, repair_batches, exceptions, runs, rules, settings; `DROP
FUNCTION`/`DROP VIEW` for 087/088) — not included in this release since nothing
has been deployed to production yet and the assignment explicitly asks for
migrations to only ever move forward once applied.

## Stage D — Controlled repair pilot (Phase 2, not started)

- Select a small number of `CONFIRMED`-confidence exceptions (REC-001/
  REC-007's highest-confidence output is the natural starting set — it's
  exactly the CR00700 defect shape).
- Generate proposals via `POST /api/data-integrity/repair-proposals`
  (exists today, produces `DRAFT` only).
- Build and require the approval step (does not exist yet — see
  `REPAIR_GOVERNANCE.md`).
- Take a fresh backup immediately before executing the first repair batch.
- Execute one batch at a time, re-running reconciliation after each and
  confirming the exception's fingerprint no longer fires before moving to
  the next.

**Rollback**: per-batch, via `repair_audit_rows`' before image (design in
`REPAIR_GOVERNANCE.md` — the execution function itself doesn't exist yet,
so there's nothing to roll back today).

## Stage E — Prevention controls (Phase 2, not started)

- Add `business_event_id`/`idempotency_key` to `stock_ledger` (see
  `ARCHITECTURE.md`'s Phase 2 section) — only after a preflight query
  confirms the constraint won't break on existing history, per the
  assignment's explicit instruction.
- Centralize posting into one function per business action, replacing the 5
  independent triggers documented in `CURRENT_STATE_AUDIT.md` §4.
- Deprecate the legacy `/api/stock/reconcile` mutating endpoint once its one
  job (phantom purchase-line cleanup) is fully subsumed by a reviewed
  REC-002/REC-007-driven repair — see the notice already added to
  `/reports/stock-reconcile` this release pointing at `/data-integrity`.
- Remove `/api/stock/ledger-entries`' direct-delete capability only after a
  safe, evidenced replacement (Stage D's repair execution) is live and
  trusted — not before.

**Rollback**: N/A — this stage is additive constraints and a triggers
refactor, planned with its own migration-by-migration rollback story when
it's actually designed.
