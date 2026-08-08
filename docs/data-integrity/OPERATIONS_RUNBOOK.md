# Operations Runbook

## How to start a scan

Go to **Data Integrity → Reconciliation Runs** (`/data-integrity/runs`,
requires `admin`/`developer`/`company_manager`). Pick a date range and click
**Run Full Scan**. This calls `POST /api/data-integrity/runs`
(`runType: MANUAL, scopeType: FULL`), which:
1. Creates a `reconciliation_runs` row (`status: RUNNING`).
2. Runs every rule currently `is_enabled = TRUE` in the Rule Catalogue.
3. Upserts results into `reconciliation_exceptions` (new fingerprint →
   `OPEN`; existing fingerprint → `last_detected_at`/`occurrence_count`
   bumped, reopened if it had been closed).
4. Marks the run `COMPLETED` or `COMPLETED_WITH_EXCEPTIONS`.

`company_manager` must scope to a single company (the API rejects an
unscoped run for that role — see `src/lib/dataIntegrity/auth.ts`).
`billing_staff` can view results but cannot start a scan.

Nothing a scan does can change stock — every rule function is a `STABLE`
SQL `SELECT` (see `088_data_integrity_rule_functions.sql`); the only writes
in the whole path are to `reconciliation_runs`/`reconciliation_exceptions`.

## How to interpret run status

| Status | Meaning |
|---|---|
| `QUEUED` | Not yet started (reserved for a future async scheduler — today's runs go straight to `RUNNING`). |
| `RUNNING` | In progress. |
| `COMPLETED` | Finished, zero exceptions found or updated. |
| `COMPLETED_WITH_EXCEPTIONS` | Finished, one or more `reconciliation_exceptions` rows were created or touched. **This is the normal, expected outcome on a real dataset** — it does not itself mean something is broken; check the severity breakdown. |
| `FAILED` | The run's SQL script errored — see `error_message` on the run row. This means the *scan itself* broke (a bug in a rule function, a schema mismatch), not that a data defect was found. |
| `CANCELLED` | Reserved for a future manual-cancel feature; not producible today. |

## How to investigate an exception

Open **Exception Workbench** (`/data-integrity/exceptions`), filter by
severity/status, click into an exception. The detail page
(`/data-integrity/exceptions/[id]`) shows, top to bottom: summary,
explanation, suspected cause, expected/actual/difference, source document
reference, the raw `evidence` JSON (every rule populates this — for
REC-001/REC-005/REC-007/REC-008/REC-009 it includes the specific ledger row
ids involved), any preserved evidence-row snapshots, and any repair
proposal. Cross-reference `evidence.confidence` (`CONFIRMED` /
`HIGH_PROBABILITY` / `REVIEW_REQUIRED`) where the rule sets it — treat
`REVIEW_REQUIRED` as "worth a human look," not "definitely wrong."

## How to distinguish real defects from legitimate zero balances

**Zero stock is not, by itself, a defect.** REC-013 only ever produces an
exception when a zero-balance scope's own history also contains an
exact-duplicate ledger pattern — a genuinely clean zero (full purchase,
full consumption, matching quantities) never appears in the Exception
Workbench at all. If you're looking at an item with `current_stock = 0` and
it has *no* open REC-013 exception, that's the system confirming it's
clean, not silence/an oversight.

## What to do when a scan fails

1. Check the run's `error_message` (visible in the Reconciliation Runs
   table via the ⚠ icon, or `GET /api/data-integrity/runs/[id]`).
2. Most likely causes: a new migration changed a column this module
   depends on (`stock_ledger`, `purchase_bill_items`, `job_work_items`,
   `transfers`/`transfer_items`, or the cancellation archive tables) without
   a corresponding update to `088_data_integrity_rule_functions.sql`, or a
   Hasura connectivity issue affecting `hasuraRunSql` generally (check
   whether *other* parts of the app are also failing — this module uses the
   exact same `hasuraRunSql` path as everything else, per
   `CURRENT_STATE_AUDIT.md` §5).
3. A failed run does not corrupt state — `reconciliation_exceptions` from
   prior successful runs are untouched. Re-run once the underlying issue is
   fixed.

## How to re-run a targeted scan

`POST /api/data-integrity/runs` accepts an optional `ruleCodes: string[]`
(must be a subset of the 9 implemented codes — see `RULE_CATALOGUE.md`) to
scope a run to specific rules, and `companyId`/`fromDate`/`toDate` to scope
by company and date range. The UI's "Run Full Scan" button always runs every
enabled rule; a targeted re-run today requires calling the API directly
(e.g. from an admin's browser console or a script) — a UI control for this
is a natural small Phase 2 addition, not present in this release.

## How to export evidence

Not implemented in this release. The assignment's professional-Excel-export
requirement (§16) is deferred — see the "Known limitations" section of the
final delivery report. `GET /api/data-integrity/exceptions` and
`GET /api/data-integrity/exceptions/[id]` return full JSON that a script
could pipe into the existing `exportProfessionalExcel` helper
(`src/lib/exportProfessionalExcel.ts`, already used by
`reports/stock-reconcile`) as a fast Phase 2 follow-up.

## How repair proposals work (and their current limit)

`POST /api/data-integrity/repair-proposals` (admin/developer only) creates a
`DRAFT` `repair_batches` row referencing an exception, with a
`before_snapshot` capturing the exception's full state at proposal time.
**There is no approval or execution endpoint** — a proposal is a documented
intention, reviewable via `GET /api/data-integrity/repair-batches/[id]`, and
nothing more. See `REPAIR_GOVERNANCE.md`.

## Why direct production SQL fixes should be avoided

See `REPAIR_GOVERNANCE.md`'s closing section. Short version: a hand-written
`DELETE`/`UPDATE` against production (like migration 084's CR00700 fix)
leaves no fingerprint, no before/after snapshot, and no link back to which
rule would have caught it — this module exists to make that evidence
automatic.

## Backup and recovery

This module does not change WareCore's existing backup procedure
(`/api/backup/*`, per project memory — unrelated to this release). Because
Stage A/B/C of the rollout (`ROLLOUT_PLAN.md`) never write to `stock_ledger`
or any pre-existing table, there is nothing new to back up until Stage D
(controlled repair pilot) actually begins executing repairs — at which
point "take a fresh backup immediately before executing the first repair
batch" (already stated in `ROLLOUT_PLAN.md`) is the operative procedure.

## Emergency disable procedure

Nothing in this release can execute a repair or otherwise mutate
`stock_ledger`, so there is no "emergency stop" needed for that risk in this
phase. To disable the module's *visibility* entirely without a code change:
remove the `{ title: 'Data Integrity', href: '/data-integrity', icon: '🛡️' }`
entry from `navItems` in `src/app/(app)/layout.tsx` and the pages will still
exist but no longer be linked (they remain reachable by direct URL for
`CAN_VIEW` roles — the role gate in `src/app/(app)/data-integrity/layout.tsx`
is the actual access control, not the nav link). To stop scans from being
started, revoke the relevant roles' access via the existing Roles &
Permissions admin screen or set `reconciliation_settings` fields
conservatively (there's no "disable scanning" flag specifically — the
closest lever today is not calling `POST /api/data-integrity/runs`, which
requires deliberate action from an authorized role in the first place).
