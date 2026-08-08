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

## Stage B — Production-copy shadow test (performed 2026-08-08)

**Tooling**: `scripts/data-integrity/stage-b-shadow-scan.mjs`. Pulls a
minimized, read-only snapshot of 18 production tables via the app's own
`getAllTableData()`/`hasuraRunSql()` path (`src/lib/backup/backup.service.ts`
— the same mechanism `/api/backup/export` uses), excluding `user_profiles`
entirely (avoids pulling `password_hash`) and dropping PII/free-text/pricing
columns from every other table (no contact info, no notes, no rate/amount).
Loads the snapshot into a fresh throwaway embedded Postgres with
`session_replication_role = replica` (so historical rows don't re-fire
`fn_bill_item_to_ledger()` etc. and get double-posted or assigned fresh
`purchase_line_id`s), runs every implemented rule, prints aggregate counts,
then destroys the database. Every production query used Hasura's
`read_only: true` flag. Nothing was written to production, nothing was
persisted to disk, no per-row snapshot data appears in this repo or any
committed file — only the aggregate/example findings below.

**Two real bugs in this package's own SQL were found and fixed by this run**
(exactly why Stage B matters — the synthetic test suite's scenarios never
had more than one ledger row sharing a scope's latest `entry_date`, so this
never surfaced there):
1. **REC-014 false positives**: 117 CRITICAL findings on the first run, all
   spurious. `fn_reconcile_rec_014`'s "pick the final row" subquery used
   `ORDER BY entry_date DESC, quantity DESC LIMIT 1` to find
   `fn_stock_movement_history`'s last row — but the window function's own
   traversal order is `entry_date ASC, quantity DESC, created_at ASC`, so
   the correct reverse-order pick needed `quantity ASC`, not `quantity DESC`
   again. Any scope with more than one row on its latest `entry_date` could
   pick a mid-sequence cumulative value instead of the true final one. Fixed
   in `088_data_integrity_rule_functions.sql`; re-run: **0** REC-014
   findings.
2. **REC-005 severity/current-balance misreporting**: the same tie-break bug
   in the `latest` CTE (didn't affect *whether* a scope was flagged — that
   uses a true `MIN()` over all rows — only the reported `current_balance`
   and CRITICAL-vs-HIGH classification). Fixed the same way.

**Findings against real production data, after all three bugs below were
fixed** (819 `stock_ledger` rows, 265 purchase bills, 122 dispatch orders,
80 job work orders, full history):

| Rule | Count | Severity |
|---|---:|---|
| REC-001 (duplicate events) | 0 | — |
| REC-002 (missing postings) | 0 | — |
| REC-003 (orphans) | 0 | — |
| REC-005 (negative stock, company-wide) | 4 | CRITICAL — (was 26 per-warehouse, see below) |
| REC-007 (reversal mismatch) | 0 | — |
| REC-008 (transfer pairs) | 0 | — (0 `transfers` rows in this dataset) |
| REC-009 (job work equation) | 5 | HIGH — (was 43 pre-fix, see below) |
| REC-013 (zero-stock, corroborated) | 0 | — |
| REC-014 (report self-consistency) | 0 | — (was 117 pre-fix, see below) |
| REC-018 (vendor balance cross-check) | 52 | HIGH — (was 122 in the earlier scan; REC-018 doesn't share any code with REC-009, so this drop isn't the same fix — most likely real business activity in production between scans over this session, not independently confirmed) |

**Total: 61 real exceptions**, all live in the production Exception
Workbench.

**REC-001/REC-007/REC-008/REC-014 all reading zero is itself meaningful
validation**: it confirms the CR00700 defect (migration 084) and the other
one-off repairs (071, 073, 077–083) actually closed out the specific issues
they targeted, and that no *new* duplicate/reversal/transfer defects have
crept in since. REC-005/REC-009/REC-018's non-zero counts were spot-checked,
not just counted — see below.

**Spot-check (REC-009 + REC-018, same vendor/material)**: for one vendor's
raw material, 3 active (`status='dispatched'`) job work orders show their
own `job_work_items.quantity_sent - quantity_received - quantity_transferred_out`
disagreeing with their own ledger postings by 1.4, 12.4, and 25.0 units
respectively — two of the three orders' source columns say "fully closed"
(0 pending) while the ledger still carries a real, uncleared balance. This
is a genuine, previously-undetected data-integrity gap, not a rule
implementation artifact — consistent with `CURRENT_STATE_AUDIT.md` §1's
observation that job-work-transfer accounting has been this codebase's most
recurring bug class (migrations 056–084).

**A third real bug, found while investigating that spot-check further**:
tracing REC-009's flagged rows for order `JW-MSIWT6Y4-GX93` surfaced 6
separate exceptions all reporting the identical `actual_value` (21.960)
against 6 different `expected_value`s — a strong signature of a rule bug,
not 6 real defects. Confirmed: the order has 6 `job_work_items` lines
sharing the same material+size (distinct physical coils of the identical
spec), and their `quantity_sent` values (4.875 + 3.515 + 3.445 + 3.055 +
2.180 + 4.890) sum to exactly 21.960 — the ledger total. REC-009 was
comparing each line's own quantity against the *scope-wide* ledger total
instead of summing lines that share a scope first. Fixed in
`088_data_integrity_rule_functions.sql` (now groups by
`(order, material_type, material_size)` and aggregates before comparing);
4 new tests added reproducing this exact scenario plus a genuine
multi-line mismatch case. Re-scanned production: **REC-009 dropped from 43
to 5** real findings — the other 38 were this false-positive pattern, not
data defects. The 38 stale exception rows were marked `IGNORED` with an
explanatory note (not deleted — the evidence stays, just correctly
labeled) since their fingerprint format changed and a re-scan wouldn't
have superseded them on its own.

**A fourth issue — not a bug, a scoping decision that needed the business
owner's input**: tracing REC-005's 26 findings showed 19 of them in
warehouses named "VSS"/"Warehouse (SSS Virtual)"/"Warehouse (DSS virtual)".
Tracing the worst cases (e.g. purchase line `GA0424-0001`): the
`PURCHASE_IN` posted to one warehouse, the `JOB_WORK_OUT` (and everything
after it) posted to a *different* warehouse — with the two warehouses'
combined net exactly `0.000` for several of the largest findings. Asked the
business owner directly: **confirmed intentional** — "Opening Stock" and
the "Virtual" warehouses are deliberate bookkeeping constructs, not a data
entry mistake. Per their direction, REC-005 was rescoped from
per-warehouse to per-company (aggregating a company's warehouses together
before checking for a negative balance) — still catches a genuine
company-wide deficit, just not an intentional internal split. Re-ran:
**REC-005 dropped from 26 to 4** — all four in one specific company
("DS Steel Enterprises"), all caused by `SALE_OUT` rows, not yet
individually traced. The 22 no-longer-relevant exception rows were marked
`IGNORED` with the business owner's confirmation recorded in
`resolution_notes`.

**Total exceptions after all four fixes: 61** (4 REC-005, 5 REC-009, 52
REC-018) — all live in the Exception Workbench in production.

**Final state after this session's triage** (`reconciliation_exceptions`
grouped by rule + status):

| Rule | Status | Count | Why |
|---|---|---:|---|
| REC-005 | `IGNORED` | 30 | Confirmed intentional by the business owner — 26 per-warehouse splits (rescoped to company-wide, see the REC-005 rescoping note above) + 4 cross-company splits (Sri Sai Steels ↔ DS Steel Enterprises, confirmed sister entities sharing inventory) |
| REC-009 | `IGNORED` | 43 | The line-vs-scope aggregation bug, already fixed and explained above |
| REC-009 | `RESOLVED` | 5 | Genuinely fixed — `quantity_received` synced to the ledger (see the Stage D incident note below for how this repair itself went sideways and was corrected) |
| REC-018 | `OPEN` | 52 | **Not yet investigated** — the real remaining work |

Only REC-018's 52 findings are still open and untriaged. Everything else is
either a confirmed non-issue (with the business owner's reasoning recorded
in `resolution_notes`) or genuinely fixed. `reconciliation_settings.quantity_tolerance`
at `0.001` did not need tuning against this dataset — no findings were
borderline/near-zero.

**Rollback**: the shadow database is disposable — delete it, nothing to undo.

## Stage C — Production shadow mode (performed 2026-08-08)

- Deployed the schema (migrations 085–089), the API routes, and the UI to
  production (`main` branch, `warecore.vercel.app`).
- **Repair execution remains disabled** (`reconciliation_settings.repair_execution_enabled = FALSE`,
  unchanged from its migration default — nothing in this release can flip
  it anyway, since no execution code exists). No ledger data was altered at
  any point in this stage, including via the legacy `/reports/stock-reconcile`
  "Run Reconciliation" button, which was left untouched.
- Ran the first live scan through the deployed API — it initially crashed
  (HTTP 500) due to a bug in `runReconciliation()`'s SQL result parsing
  (see git history, commit `b524d40`); the underlying scan had actually
  executed and committed correctly, only the API response and the run's
  own status column were affected. Fixed and redeployed the same session.
- Scheduled scans (manual, via `/data-integrity/runs`, until a real
  scheduler is wired up — see `OPERATIONS_RUNBOOK.md`'s note on
  scheduling; this repo has no cron infrastructure today, per
  `CURRENT_STATE_AUDIT.md` §8) are not yet set up — every run so far has
  been triggered manually.

**Rollback**: drop the 8 new tables (085) and 2 new functions/3 views (087,
088) — none of them are referenced by any existing table/trigger/view, so
this is a clean, isolated rollback. A rollback migration is trivial to write
if ever needed (`DROP TABLE ... CASCADE` in dependency order: exception_rows,
repair_audit_rows, repair_batches, exceptions, runs, rules, settings; `DROP
FUNCTION`/`DROP VIEW` for 087/088) — not included in this release since nothing
has been deployed to production yet and the assignment explicitly asks for
migrations to only ever move forward once applied.

## Stage D — Controlled repair pilot (Phase 2, not started as a formal process — one manual repair performed 2026-08-08, with a live demonstration of exactly why this stage needs to be a reviewed function, not an ad hoc UPDATE)

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

**Incident, same session**: fixing the 5 confirmed REC-009 exceptions
(`job_work_items.quantity_received` left at 0 despite the ledger already
correctly recording the return — see the section above) was done as a
direct `UPDATE job_work_items SET quantity_received = ...`, on the
reasoning that it only touched a source column, not `stock_ledger`. That
reasoning was wrong: `trg_job_work_item_to_ledger` fires on `UPDATE` too
(`CURRENT_STATE_AUDIT.md` §4), and reacted to the increase by posting 5
*new* `JOB_WORK_RETURN_IN` rows — dated today instead of the real 2024
event, and duplicating amounts the ledger already correctly had. Caught
immediately: re-running REC-014 (report self-consistency) would have
stayed at 0 either way here (it checks running-balance math, not row
count), but a direct check of `stock_ledger` for rows created in the same
instant as the `UPDATE` showed exactly 5 new rows matching the 5 values
just set. Deleted those 5 specific rows (identified unambiguously by
`created_at` and matching quantity — no ambiguity, nothing else touched),
re-verified REC-009 and REC-014 both read 0, and re-ran REC-001/REC-005/
REC-007 as a broader sanity check before considering it closed.

**This is precisely the scenario `REPAIR_GOVERNANCE.md` describes and
Stage D is designed to prevent going forward**: a manual fix that looked
safe on inspection had a side effect a reviewed, transactional repair
function with a "re-run reconciliation before committing, roll back if it
didn't work" step would have caught *before* the duplicate rows ever
committed, not after. This one repair was corrected within minutes because
it was caught by immediately re-running the same reconciliation rules used
throughout this session — but it's the concrete argument for why Stage D's
actual execution function (still unbuilt) must wrap every repair in
exactly that check-then-commit-or-rollback pattern, not trust a human's
read of what a table update will do.

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
