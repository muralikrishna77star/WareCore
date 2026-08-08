# Reconciliation Rule Catalogue

All 18 rules from the assignment are catalogued in the `reconciliation_rules`
table (seeded by `supabase/migrations/086_data_integrity_seed_rules.sql`,
REC-018 enabled by `089_data_integrity_rec018.sql`).
**10 are implemented** as executable PostgreSQL functions in this release
(`is_enabled = TRUE`); the other **8 are fully specified here but not yet
coded** (`is_enabled = FALSE`) — a scan only ever invokes enabled rules, so
an unimplemented rule is never silently skipped at run time, it's just not
in the catalogue as runnable yet.

Every implemented rule is a `STABLE` SQL function,
`fn_reconcile_rec_XXX(p_company_id UUID, p_from_date DATE, p_to_date DATE)`,
returning `SETOF reconciliation_candidate` (defined in
`088_data_integrity_rule_functions.sql`, REC-018 in
`089_data_integrity_rec018.sql`). None of them write anything —
`src/lib/dataIntegrity/engine.ts` is the only thing that turns their output
into persisted `reconciliation_exceptions` rows, via an `INSERT ... ON
CONFLICT (fingerprint) DO UPDATE`.

## Implemented (Phase 1)

### REC-001 — Exact duplicate ledger event
**Severity: HIGH** (per-instance severity is actually computed dynamically —
HIGH/MEDIUM/LOW by how close together the duplicate rows were created,
matching the assignment's confidence-scoring instruction).
Groups `stock_ledger` rows sharing entry type, source reference, line, item,
company, warehouse, and quantity. Confidence:
- **CONFIRMED** (severity HIGH): rows created within 1 hour of each other —
  the double-submit signature. This is exactly the CR00700 shape (2m43s apart).
- **HIGH_PROBABILITY** (severity MEDIUM): created 1 hour–30 days apart.
- **REVIEW_REQUIRED** (severity LOW): created more than 30 days apart —
  could be two legitimate identical movements; never auto-flagged higher
  than LOW without more evidence.

Never proposes deletion — only ever produces an exception for review.

**Known gap, found by `tests/data-integrity/purchase-lifecycle.test.ts`**:
grouping includes `purchase_line_id` as an identity column, so REC-001
catches "the same line posted/cancelled twice" (CR00700's exact shape —
one `purchase_bill_items` row, two `PURCHASE_CANCEL` rows against its one
`purchase_line_id`) but does **not** catch "two independently-created lines
that are business-duplicates of each other" — e.g. a double-submit that
creates two separate `purchase_bill_items` rows (each gets its own
auto-generated `purchase_line_id` via `generate_purchase_line_id()`,
migration 020), both legitimately posting `PURCHASE_IN`. From the ledger's
perspective these are two structurally distinct, valid lines — the
duplication is only visible at the business level (same bill, same
material, same quantity, near-identical timestamp). Closing this gap is
REC-016's job (duplicate source business identifier — catalogued, not yet
implemented) or a Phase 2 extension to REC-001 that also groups by
`(reference_id, material_type_id, material_size_id, quantity)` without
requiring `purchase_line_id` to match, tie-broken by `created_at` proximity
the same way the existing confidence scoring works.
Requires at least one stable line/reference key (`purchase_line_id`,
`sub_purchase_line_id`, or `reference_id`) to avoid false positives on
under-specified rows.

### REC-002 — Missing ledger posting
**Severity: HIGH.** Two sub-checks:
- **Purchase** (line-level, exact): an active `purchase_bill_items` row with
  no matching `PURCHASE_IN` row for its `purchase_line_id`.
- **Dispatch** (order-level, approximate): `dispatch_items` has no stable
  per-line key carried onto `stock_ledger` (unlike purchase), so this
  compares total dispatched quantity per order against total posted
  `SALE_OUT` for that order. Documented limitation, not a hidden gap —
  flagged `evidence.granularity = 'order-level'`.
- **Not yet covered**: transfer, job work issue/return/output/vendor-transfer,
  and adjustments (adjustments have no source table at all — see
  CURRENT_STATE_AUDIT.md §3, `ADJUSTMENT_IN`/`OUT` are dead entry types).
  These are the direct backlog for extending REC-002 in Phase 2 — same rule
  code, more sub-checks, not a new rule.

### REC-003 — Orphan ledger entry
**Severity: MEDIUM.** A `stock_ledger` row whose `reference_id` resolves to
nothing in either the live source table or the matching cancellation/archive
table (`purchase_cancellations.original_bill_id`,
`dispatch_cancellations.original_order_id`,
`job_work_cancellations.original_order_id`, or `transfers` directly — no
archive table exists for transfers). Mirrors the exact live/archive pairing
already used by `reports/item-ledger/page.tsx`'s `findOrphanedReferences()`
and `/api/stock/verify`'s stale-records check, expressed once as the
canonical version instead of being reimplemented ad hoc in each report.

### REC-005 — Negative company-wide stock
**Severity: CRITICAL if currently negative, HIGH if it recovered.** Walks
full chronological history per **company/material/size** — deliberately
*not* per warehouse (see below) — (ordered `entry_date, quantity DESC,
created_at` — same tie-break as the canonical layer, never reordered to
hide a real dip) and reports the minimum balance ever reached, which row
caused it, and the current balance. Only scopes that actually went below
`-0.001` are returned — this is the rule the assignment is most explicit
about never gaming: "Do not hide a negative chronological balance by
sorting inflows before outflows."

*Bug found and fixed via the Stage B shadow test against real production
data* (`ROLLOUT_PLAN.md`): the `current_balance` "pick the last row"
tie-break didn't reverse the window function's own quantity ordering
correctly, which could misreport the current balance (and thus
CRITICAL-vs-HIGH severity) for a scope with more than one row sharing its
latest `entry_date` — never surfaced by the synthetic test suite, which had
no such scope.

*Rescoped from per-warehouse to per-company after investigating the real
findings* (`ROLLOUT_PLAN.md`): the original per-warehouse version produced
26 findings, 22 of which turned out to be an intentional business pattern —
purchases and their downstream job-work/sale activity are deliberately
split across an "Opening Stock"/"Virtual" warehouse and a real operating
warehouse, confirmed by the business owner, with the two warehouses' combined
net frequently exactly `0.000`. Company-wide aggregation still catches a
genuine deficit (production data confirms 4 remain, all `SALE_OUT`-caused,
all one specific company) while no longer flagging the intentional split.

### REC-007 — Reversal mismatch
**Severity: HIGH.** Two sub-checks, both an accounting invariant rather than
a timing heuristic (complementary to REC-001 — catches the same class of
defect even if the duplicate rows were created far enough apart that
REC-001 would only rate it REVIEW_REQUIRED):
- Per purchase line: `SUM(PURCHASE_CANCEL magnitude) > SUM(PURCHASE_IN)`.
- Per dispatch order: `SUM(SALE_CANCEL) > SUM(|SALE_OUT|)`.

CR00700 fails this check too (2 × 3.710 cancelled vs. 1 × 3.710 purchased) —
independent confirmation from a second rule, not just REC-001.

**Not yet covered**: `JOB_WORK_CANCEL` reversal matching (historical-only
entry type per the ledger event matrix — the outright-delete pattern
introduced in migration 061 means there's usually nothing left in the
ledger to check for a job-work cancellation going forward; this sub-check is
lower priority for that reason, not overlooked).

### REC-008 — Transfer pair mismatch
**Severity: HIGH.** Per transfer + material/size, `SUM(transfer_items.quantity)`
must equal both `|TRANSFER_OUT|` at the source warehouse and `TRANSFER_IN`
at the destination warehouse (both matched by `reference_id = transfers.id`).
Any of the three missing, short, or over-posted is flagged, with the
transfer's `to_company_id`/`to_warehouse_id` carried in evidence so a
reviewer doesn't have to look the transfer up separately.

### REC-009 — Job Work equation mismatch
**Severity: HIGH.** Per `(job work order, material_type, material_size)`
*scope* — summed across every `job_work_items` line sharing that scope,
excluding transfer-destination lines (`is_transfer_line = false`) — compares
the source-of-truth columns (`quantity_sent`, `quantity_received`,
`quantity_transferred_out`) against their corresponding ledger totals
(`JOB_WORK_OUT`, `JOB_WORK_RETURN_IN`, `JOB_WORK_TRANSFER_OUT`).
`JOB_WORK_OUTPUT_IN` is deliberately never compared here — per
`LEDGER_EVENT_MATRIX.md`, output is a different item, not a return of the
raw material, and summing them together "merely to force a zero balance" is
exactly the mistake the assignment warns against.

*Bug found and fixed via real production investigation, not the synthetic
test suite* (`ROLLOUT_PLAN.md`): the original version compared each
individual line's own quantity against the scope-wide ledger total —
correct only when a scope has exactly one line. An order with multiple
lines sharing the same material+size (e.g. several distinct physical coils
of the identical spec) produced one false-positive exception per line, all
reporting the same (correct) ledger total against different (individually
incomparable) per-line quantities. Confirmed on a real order: 6 lines'
`quantity_sent` values summed to exactly the ledger total. Fixed to
aggregate by scope before comparing; production's REC-009 count dropped
from 43 to 5 real findings.

### REC-013 — Zero-stock validation
**Severity: LOW, and only when something else is actually wrong.** Zero
balance is the expected, healthy state for a fully consumed item — this
rule **never** flags a clean zero (acceptance criterion #8). It only
surfaces an advisory when a zero-balance scope's own history also contains
an exact-duplicate ledger event (the same shape REC-001 detects) — i.e.
when the zero was reached by two defects cancelling out rather than by a
genuinely clean, traceable set of transactions.

### REC-014 — Report equation mismatch
**Severity: CRITICAL.** Asserts the canonical layer's own internal
consistency: `fn_stock_movement_history`'s final `running_balance` for a
range must equal `fn_stock_balance_as_of` at the range's end date, for every
scope with activity in the window. If this ever fires, it means the
canonical calculation functions themselves disagree with each other — a bug
in `087_data_integrity_canonical_stock_layer.sql`, not a data problem. This
is the rule that directly encodes "Opening + Inward − Outward = Closing"
and "a display filter must never change accounting totals."

*Bug found and fixed via the Stage B shadow test* (`ROLLOUT_PLAN.md`): the
same "reverse the window's tie-break to find the last row" mistake as
REC-005's, but here it caused 117 spurious CRITICAL findings against real
production data on the first run — a genuine implementation bug in this
rule, not 117 real accounting defects. Fixed; the same production dataset
now correctly reads 0.

### REC-018 — Unbalanced vendor-held stock
**Severity: HIGH.** Cross-checks the two independently-computed notions of
"stock currently held at a job-work vendor" that already existed in this
schema with nothing ever checking them against each other (see
`CURRENT_STATE_AUDIT.md` §7): `vw_current_vendor_stock` (087, this package
— derived from `stock_ledger` via `VENDOR_MOVEMENT_TYPES`) against the
pre-existing `v_stock_at_vendors` view (derived directly from
`job_work_items.quantity_sent/received/transferred_out`, latest body:
`056_job_work_vendor_transfer.sql`). Joined by
`(company_id, vendor_id, material_type_id, size_label)` — `v_stock_at_vendors`
groups by size *label* (text), not `material_size_id`, so that's the shared
key, with `IS NOT DISTINCT FROM` for the nullable `size_label` (the same
NULL-join class of bug REC-005 hit initially, avoided here from the start).
Deliberately point-in-time, not date-windowed — a vendor's current balance
isn't a period sum. Implemented in `089_data_integrity_rec018.sql`, added
after the initial 9-rule release specifically because it's the highest
value-per-effort item once written — see the delivery report's "next phase."

## Catalogued, not yet implemented (Phase 2 backlog)

### REC-004 — Source-to-ledger quantity mismatch
Line-level comparison of every source line's quantity against its expected
net ledger quantity, across all transaction types (broader than REC-002's
existence check — this is a *value* check assuming the posting exists).
Deferred because it substantially overlaps REC-009 (job work) and REC-002
(purchase/dispatch) in Phase 1's scope; the remaining gap is transfer and
job-work-output line-level value checks.

### REC-006 — Invalid movement sign
Validate `entry_type` against expected quantity sign per
`LEDGER_EVENT_MATRIX.md`. Straightforward to implement (a `CASE` over the 12
live entry types) — deferred purely for time, not complexity; a good
first Phase 2 pick.

### REC-010 — Company/warehouse mismatch
Ledger row's `company_id`/`warehouse_id` must agree with its source
document. Needs a per-`reference_type` join (purchase/dispatch/job
work/transfer each have their own company/warehouse columns), similar
shape to REC-003's orphan check.

### REC-011 — Effective-date mismatch / REC-012 — Backdated posting
Both need a per-entry-type "correct business date" lookup (bill date vs.
dispatch date vs. transfer date vs. job-work dispatch/return/output-received
date) — mechanically straightforward given `LEDGER_EVENT_MATRIX.md` already
enumerates the correct source per type, deferred for time.

### REC-015 — Source header/detail mismatch
Purchase bill / dispatch order header totals vs. sum of their line items.
Needs `total_quantity`/`total_amount` present on both header tables
(confirmed present) — straightforward, deferred for time.

### REC-016 — Duplicate source business identifier
Duplicate bill numbers / reference numbers / line IDs outside their
legitimate uniqueness scope (e.g. `purchase_bills` has a
`UNIQUE(supplier_id, bill_number)` constraint already, so a same-supplier
duplicate can't exist at the DB level — this rule matters most for
`job_work_orders.reference_number`, which is globally unique already, and
`purchase_line_id`/`sale_line_id`, which have no DB-level uniqueness at
all). Worth prioritizing early in Phase 2 given that gap.

### REC-017 — Trigger-chain duplicate risk
Detecting "more than one posting path fired for the same action" from
timing/shape alone, without a `business_event_id`/`idempotency_key` (§12 of
the assignment, not yet added to `stock_ledger`). Realistically this rule
becomes much more reliable *after* that Phase 2 schema addition rather than
before it — attempting it now would mostly duplicate REC-001's signal.

