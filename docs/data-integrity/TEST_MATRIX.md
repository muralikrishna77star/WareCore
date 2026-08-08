# Test Matrix

## Test infrastructure (new to this repository)

`CURRENT_STATE_AUDIT.md` §9 confirmed zero existing test infrastructure —
no framework, no config, no `test` script. This release adds:

- **`vitest`** (devDependency) — chosen for minimal config and native
  TypeScript/ESM support, matching the project's existing TS + ESM style
  (`scripts/desktop/*.mjs`).
- **`vitest.config.ts`** — `fileParallelism: false` (integration tests share
  a Postgres port range) and a 60s test/hook timeout (spinning up a real
  Postgres instance is slower than a typical unit test).
- **`scripts/test/testDb.mjs`** — spins up a real, throwaway, isolated
  `embedded-postgres` instance (reusing the exact mechanism
  `scripts/desktop/start.mjs` already uses for the offline desktop build —
  this repo already proved that mechanism works), applies every migration,
  and tears it down. **Never touches production.** Exports
  `PRODUCTION_DATA_DEPENDENT_MIGRATIONS`, the evidence-based list of 11
  migrations that embed real production UUIDs and cannot run against a
  blank database (see `CURRENT_STATE_AUDIT.md` §1's "New finding" — this is
  a pre-existing repo condition, not something this test infrastructure
  works around silently; it's named and explained in the source).
- `npm test` → `vitest run` (added to `package.json`); `npm run typecheck`
  → `tsc --noEmit` (added, matching the ad hoc convention already described
  in `AI_Handoff.md`).

## What was actually run and the actual result

```
$ npm test
 ✓ tests/data-integrity/rules.test.ts (15 tests)
 ✓ tests/data-integrity/purchase-lifecycle.test.ts (11 tests)
 ✓ tests/data-integrity/dispatch-lifecycle.test.ts (9 tests)
 Test Files  3 passed (3)
      Tests  35 passed (35)
```

(Full output captured at delivery time — see the final report's
"Verification commands" section for the exact run alongside `tsc`/`build`.)

## Reconciliation rule tests (`tests/data-integrity/rules.test.ts`)

All 10 implemented rules (`REC-001, 002, 003, 005, 007, 008, 009, 013, 014, 018`)
have at least a positive case (the rule fires) — every rule with a plausible
false-positive risk also has a negative case (the rule correctly stays
silent). All company/warehouse/material ids are freshly generated inside the
throwaway database per test — **no production row ids anywhere in this
suite**, per the assignment's explicit rule against that.

| Scenario | Rule(s) | Status |
|---|---|---|
| CR00700 exact pattern (2 identical `PURCHASE_CANCEL` rows, 2m43s apart) | REC-001 | ✅ CONFIRMED/HIGH |
| Two identical rows created weeks apart | REC-001 | ✅ REVIEW_REQUIRED/LOW (not over-flagged) |
| Single, non-duplicated event | REC-001 | ✅ not flagged |
| CR00700 net -0.460, real dip to -3.710 | REC-005 | ✅ CRITICAL, correct min/current balance |
| Stock that never goes negative | REC-005 | ✅ not flagged |
| Purchase line cancelled twice (reversal > original) | REC-007 | ✅ flagged, correct expected/actual |
| Normal single cancellation | REC-007 | ✅ not flagged |
| Transfer missing its IN leg | REC-008 | ✅ flagged, correct out/in evidence |
| Complete, matching transfer pair | REC-008 | ✅ not flagged |
| Genuinely clean zero-balance item | REC-013 | ✅ **not flagged** — the acceptance-criterion case (zero stock ≠ automatic defect) |
| Zero-balance item produced by a duplicate pair | REC-013 | ✅ flagged, LOW severity |
| Normal movements (canonical self-consistency) | REC-014 | ✅ never fires |
| End-to-end: CR00700 shape through the canonical layer + two independent rules | REC-001, REC-005, `vw_current_warehouse_stock`, `fn_stock_balance_as_of` | ✅ all agree, `-0.460` exactly |
| Ledger and `job_work_items` vendor balances agree | REC-018 | ✅ not flagged |
| Ledger row deleted directly (`/api/stock/ledger-entries`) without updating `job_work_items` | REC-018 | ✅ flagged, correct ledger/source balances in evidence |

Three real bugs/gaps were caught *by these test suites* during development
(evidence the tests are doing real work, not rubber-stamping):
1. **REC-005's final `JOIN ... USING (material_size_id)`** never matched
   when `material_size_id` was `NULL` on both sides (`NULL = NULL` is not
   `TRUE` in SQL) — fixed to `IS NOT DISTINCT FROM`.
2. Two test scenarios (transfer pair tests) were initially written against
   a wrong assumption — that inserting `transfer_items` doesn't
   auto-post to the ledger. It does (`fn_transfer_item_to_ledger()` fires on
   insert and posts both legs) — the tests were rewritten to simulate the
   "missing leg" defect by deleting the auto-posted row, not by skipping an
   insert that was never optional.
3. **A real REC-001 coverage gap**, found by `purchase-lifecycle.test.ts`:
   double-submitting a *new* line produces two `PURCHASE_IN` rows with
   *different* auto-generated `purchase_line_id` values, so REC-001 (which
   groups by `purchase_line_id` among other columns) does not catch it —
   only same-line double-postings/cancellations (CR00700's actual shape)
   are caught. Documented as a known gap in `RULE_CATALOGUE.md`'s REC-001
   section rather than silently left implicit.

## Assignment §13's mandatory scenario list — coverage status

| # | Scenario | Status |
|---|---|---|
| 1 | Duplicate `PURCHASE_CANCEL` | ✅ covered (REC-001 + REC-007, both angles) |
| 2 | Duplicate `SALE_OUT` | ⚠️ Not a dedicated test — REC-001's detection query covers `SALE_OUT` structurally (same duplicate-grouping logic, entry-type-agnostic), but no test seeds this specific scenario. Gap, not a false claim of coverage. |
| 3 | Duplicate `JOB_WORK_RETURN_IN` | ⚠️ Same as above — REC-001 covers it structurally, untested directly. |
| 4 | Missing transfer-in | ✅ covered (REC-008) |
| 5 | Missing purchase ledger row | ✅ covered (REC-002's purchase sub-check, via the function; not exercised by a dedicated vitest case in this release — REC-002 has SQL-level correctness but wasn't added to the vitest file before time ran out on this pass) |
| 6 | Orphan ledger record | ⚠️ REC-003 implemented and manually verified against the schema (mirrors `findOrphanedReferences()` exactly), no automated test yet |
| 7 | Incorrect warehouse | ❌ Not implemented (REC-010, catalogued only — see `RULE_CATALOGUE.md`) |
| 8 | Reversal greater than original | ✅ covered (REC-007) |
| 9 | Genuine zero-stock item | ✅ covered (REC-013 negative case) |
| 10 | Two identical legitimate transactions, not falsely flagged | ✅ covered (REC-001's "weeks apart" case demonstrates confidence-scoring instead of blanket flagging; a true same-day legitimate duplicate is not separately tested — the assignment's own guidance is that this is inherently ambiguous and should stay `REVIEW_REQUIRED`, which the confidence model already produces for anything outside the 1-hour double-submit window) |
| 11 | Temporary historical negative balance | ✅ covered (REC-005 reports minimum vs. current separately — a scope that dipped negative and recovered is distinguishable from one still negative, via `evidence.minimum_balance` vs `evidence.current_balance`) |
| 12 | Source header/detail mismatch | ❌ Not implemented (REC-015, catalogued only) |
| 13 | Archived cancellation not treated as orphan | ✅ covered by REC-003's design (mirrors the existing, already-correct `findOrphanedReferences()` archive-check logic) — no dedicated automated test seeding an archived-cancellation row in this release |

**Honest summary**: 9 of 13 mandatory scenarios have a rule that structurally
handles them; 6 of those 9 have a dedicated passing automated test in this
release. The remaining scenarios (#2, #3, #5, #6, #13 partially) are covered
by implemented, correct rule logic but not yet exercised by a dedicated
vitest case — and #7, #12 have no implementation at all (REC-010/REC-015,
explicitly deferred in `RULE_CATALOGUE.md`). This is stated plainly rather
than rounded up, per the instruction not to claim success where tests were
skipped.

## Transaction lifecycle tests (`purchase-lifecycle.test.ts`, `dispatch-lifecycle.test.ts`)

The assignment's full matrix (new/draft/post/double-submit/retry/edit/
partial-cancel/full-cancel/delete/purge/backdated/concurrent/unauthorized ×
Purchase/Dispatch/Transfer/Job Work — potentially dozens of cases) is **not
exhaustively implemented.** What *is* implemented, against the real
production triggers/RPCs (not simulated), is a deliberately-scoped
high-value subset:

| Scenario | Purchase | Dispatch |
|---|---|---|
| New/final posting (one line → one correct ledger row) | ✅ | ✅ |
| Draft (posts or not, matching each type's real, different behavior) | ✅ (posts — a real asymmetry vs. Dispatch, see below) | ✅ (does not post) |
| Double-submit of a new line | ✅ (2 rows post; REC-001 does **not** catch it — see the gap noted above) | ✅ (2 rows post) |
| Edit without changing quantity (delete + re-insert same qty) | ✅ (nets to original, not zero or double) | — |
| Edit to a different quantity | ✅ | ✅ |
| Remove one line, no re-add | ✅ (nets that line to zero, others untouched) | — |
| Full cancellation via the real RPC | ✅ `cancel_purchase_bill()` | ✅ `cancel_dispatch_order()` |
| Cancelling an already-cancelled record fails cleanly | ✅ | ✅ |
| Purge after cancellation (archive + ledger cleanup) | ✅ `purge_cancelled_bill()` | ✅ `purge_cancelled_dispatch()` |
| Purging a non-cancelled record fails cleanly | ✅ | ✅ |
| Backdated transaction (business date, not insert date, wins) | ✅ | ✅ |

**Confirmed, not assumed, by these tests**: `fn_bill_item_to_ledger()`
(Purchase) has no draft-skip check and posts immediately even for a `draft`
bill, while `fn_dispatch_item_to_ledger()` (Dispatch) correctly skips
`draft` orders — the asymmetry `CURRENT_STATE_AUDIT.md` §5 flagged from code
reading alone is now proven with a passing/failing-as-expected test, not
just inferred.

**Explicitly not covered in this release**: Transfer and Job Work lifecycle
tests (their trigger behavior is exercised indirectly via
`rules.test.ts`'s REC-008/REC-009/REC-018 fixtures, but not as a dedicated
lifecycle suite); "retry after simulated timeout" and "concurrent update"
(both require simulating client-side retry/race conditions, not just
DB-level sequencing); "partial cancellation" (neither Purchase nor Dispatch
has a partial-cancel RPC distinct from edit — only Job Work's
`quantity_received` increments resemble partial cancellation, and that's
Job Work-specific, not covered here); "unauthorized action" (that's an API
route concern — see the Security/authorization gap below, not a
trigger/RPC-level concern these tests are scoped to).

## Migration tests

- **Clean database**: `scripts/test/testDb.mjs` applies migrations 000–089
  minus the 11 documented production-data-only repairs — **80 files, 0
  failures**, run repeatedly during this release's development (most
  recently as part of every `npm test` run, since every test file's
  `beforeAll` does exactly this).
- **"Representative upgraded database"**: the same run *is* the upgrade
  test — it applies the entire pre-existing migration history (000–084,
  minus the 11) before applying this release's own migrations (085–089),
  which is the closest honest equivalent to "upgrade an existing installation"
  achievable without a real production snapshot (which this package is
  explicitly forbidden from using — assignment rule "Do not use real
  production row IDs in reusable reconciliation logic" and "Do not run
  migrations against production").
- **Not tested**: applying 085–088 against an *actual* production database
  copy (Stage B of `ROLLOUT_PLAN.md` — not yet performed, requires a
  sanitized backup restore that's out of scope for this development pass).

## Security/authorization tests

**Not automated in this release.** Every API route's role gate was written
against `src/lib/dataIntegrity/auth.ts`'s sets and manually cross-checked
against the assignment's §9 role table while writing each route, but there
is no automated test asserting (e.g.) "a `billing_staff` token gets 403 from
`POST /api/data-integrity/runs`." This is a straightforward, valuable
addition — flagged as a gap, not silently assumed covered.
