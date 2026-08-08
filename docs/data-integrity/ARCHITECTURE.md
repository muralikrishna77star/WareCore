# Data Integrity & Reconciliation Control Centre — Architecture

## Design principle

`stock_ledger` remains the single source of truth. Nothing in this package
writes to it, deletes from it, or reinterprets its history. The module is
purely additive: 7 new tables, 4 canonical read functions/views, 9 read-only
rule functions, orchestration in `src/lib/dataIntegrity/`, and a UI under
`/data-integrity`. See `CURRENT_STATE_AUDIT.md` for what already exists and
why this was needed.

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  UI  (src/app/(app)/data-integrity/*)                        │
│  Dashboard · Runs · Exception Workbench · Exception Detail ·  │
│  Rule Catalogue — all server components, read-only rendering  │
└───────────────────────┬────────────────────────────────────┘
                         │ fetch (client) / hasuraRunSql (server)
┌───────────────────────▼────────────────────────────────────┐
│  API  (src/app/api/data-integrity/*)                         │
│  Auth + input validation only — see auth.ts's CAN_VIEW /      │
│  CAN_RUN_SCAN / CAN_MANAGE_RULES / CAN_PROPOSE_REPAIR sets    │
└───────────────────────┬────────────────────────────────────┘
                         │ hasuraRunSql (raw SQL, same pattern as
                         │ every other route in this codebase)
┌───────────────────────▼────────────────────────────────────┐
│  Orchestration  (src/lib/dataIntegrity/engine.ts)             │
│  Decides which rules run, stitches results into persistent    │
│  rows. No accounting math lives here.                         │
└───────────────────────┬────────────────────────────────────┘
                         │
┌───────────────────────▼────────────────────────────────────┐
│  Rule functions (088) — fn_reconcile_rec_XXX()                │
│  Pure SELECT, SETOF reconciliation_candidate. All accounting  │
│  math happens here, in decimal-safe Postgres NUMERIC.          │
├────────────────────────────────────────────────────────────┤
│  Canonical layer (087) — vw_stock_ledger_normalized,           │
│  vw_current_warehouse_stock, vw_current_vendor_stock,          │
│  fn_stock_balance_as_of, fn_stock_movement_history              │
├────────────────────────────────────────────────────────────┤
│  stock_ledger + source tables (unchanged, pre-existing)        │
└────────────────────────────────────────────────────────────┘
```

## Why SQL functions, not a TypeScript rules engine

The assignment is explicit: "Prefer PostgreSQL set-based checks. Keep the
Next.js API as orchestration and authorization, not the accounting-
calculation authority." Concretely, this means:
- Every quantity comparison uses Postgres `NUMERIC`/`DECIMAL` arithmetic,
  never JavaScript floats — `stock_ledger.quantity` is already
  `DECIMAL(15,3)`, and the new `reconciliation_candidate` composite type
  uses `NUMERIC(18,6)` throughout (088).
- A rule can be tested with pure SQL against a throwaway database
  (`scripts/test/testDb.mjs`) without any of the Next.js/Hasura stack —
  see `tests/data-integrity/rules.test.ts`, which does exactly this.
- The rule logic is auditable by reading one `.sql` file
  (`088_data_integrity_rule_functions.sql`) rather than tracing through
  TypeScript that reassembles SQL fragments.

## Canonical stock calculation layer (087)

`fn_stock_balance_as_of` and `fn_stock_movement_history` express the single
equation every report in this codebase is supposed to satisfy:

```
opening stock + Σ(signed movements up to date) = closing stock
```

Both functions include cancellation rows unconditionally — there is no
"hide cancelled" parameter, matching the fix already applied by hand to
`reports/item-ledger/page.tsx` this session (display filtering must never
change accounting totals). `fn_stock_movement_history`'s row ordering ties
same-date rows by `quantity DESC` before `created_at` — inflows before
outflows/cancellations — for the same reason that fix was needed: sorting
history purely by `created_at` (a data-entry timestamp, not a business
timestamp) can put a cancellation before the very row it reverses for
migrated/backfilled data.

**Not yet wired into existing reports.** Per the assignment ("First create
and test the canonical layer... compare it against current reports, and
document differences" before migrating anything), this release only builds
and tests the layer (see `TEST_MATRIX.md`'s canonical-layer test, which
reproduces the real CR00700 numbers exactly: `-0.460` MT). Repointing
`item-ledger`, `stock-statement`, `jobwork/new`'s availability picker, etc.
onto `fn_stock_movement_history` is explicitly a Phase 2 migration, done one
report at a time with a before/after comparison, not part of this release.

## Fingerprinting (no separate fingerprint module)

Each `fn_reconcile_rec_XXX()` function computes its own `fingerprint` column
directly in SQL from stable business identity — rule code + entry type +
reference/line/item/quantity identity, per rule (see the `fingerprint`
expression in each function in 088). It deliberately excludes quantity value
comparisons and timestamps as the *sole* key (REC-001's fingerprint, for
example, keys on entry_type/reference/line/quantity — quantity is part of
identity there because two duplicate rows must share it by definition, not
because fingerprints are quantity-based generally). `UNIQUE (fingerprint)`
on `reconciliation_exceptions` (085) is what makes repeated scans idempotent
— `engine.ts`'s upsert is `ON CONFLICT (fingerprint) DO UPDATE`, bumping
`occurrence_count`/`last_detected_at` and reopening a `RESOLVED`/`IGNORED`
exception rather than creating a duplicate row.

## Repair governance (foundation only)

See `REPAIR_GOVERNANCE.md`. In one sentence: `repair_batches` can reach
`DRAFT`/`PENDING_APPROVAL` in this release and nothing else — there is no
code path anywhere (API, engine, or SQL function) that executes a repair.

## Phase 2: central posting service (not built, documented for the record)

The assignment's §12 asks this to be *prepared for*, not built. The current
architecture has 5 independent triggers each redefined many times (see
`CURRENT_STATE_AUDIT.md` §4) — the target future state is one authoritative
posting function per business action, called explicitly rather than fired
implicitly by a trigger, carrying:

```
business_event_id, idempotency_key, source_document_type, source_document_id,
source_line_type, source_line_id, original_ledger_id, posting_batch_id,
repair_batch_id, effective_at, posted_at, event_sequence, metadata JSONB
```

None of these columns exist on `stock_ledger` yet — adding them is
explicitly deferred (the assignment: "Do not enforce new uniqueness
constraints on historical data until a preflight query proves existing data
won't violate them"). REC-001/REC-007's detection queries are, in effect,
the preflight query for a future `idempotency_key` uniqueness constraint —
running them regularly and driving their open-exception count to zero is
the prerequisite for that constraint ever being safe to add.

## Indexes added (085)

`reconciliation_exceptions`: `status`, `(severity, status)`,
`(company_id, status)`, `run_id`, `rule_id`,
`(source_document_type, source_document_id)`, and a partial index on open
statuses (`WHERE status NOT IN ('RESOLVED', 'IGNORED')`) for the dashboard's
open-count queries. `reconciliation_runs`: `(status, started_at DESC)`,
`(run_type, started_at DESC)`. No new indexes were added to `stock_ledger`
itself — the assignment's performance section requires checking query plans
first; that analysis (and the `reference_id`/`reference_type` index it would
likely justify, per `CURRENT_STATE_AUDIT.md` §2) is deferred to Phase 2 once
real exception volumes exist to profile against.
