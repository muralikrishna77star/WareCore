# WareCore Current-State Audit — Stock Ledger & Reconciliation

Status: **Phase 0 — grounded in repository inspection on 2026-08-08**
Scope: `stock_ledger` and everything that posts to, reads from, or repairs it.

This document is factual, not aspirational. Every claim below was verified against
actual files in this repository (migration SQL, API route source, report source).
Where something could not be verified (e.g. no separate staging/test database exists),
that limitation is stated explicitly rather than assumed away.

---

## 1. Migration history

`supabase/migrations/` contains **86 files**, numbered `000` through **`084`**
(`084_repair_cr00700_duplicate_cancel.sql` is the current latest — confirmed by
listing the directory, not assumed from prior conversation history).

- Numbering has one harmless anomaly: `071` is used by two different files
  (`071_repair_jw_mrqc6hy0_tsun_transfer_line.sql` and
  `071_repair_vendor_direct_sale_duplicates.sql`). The migration runner
  (`scripts/desktop/migrate.mjs`) sorts by full filename, not by numeric prefix
  alone, so both apply deterministically and in order — but this means **the
  numeric prefix is not a reliable unique key**; new migrations in this package
  use `085` onward, none of which collide.
- No numeric gaps 000–084.
- Migrations are **forward-only**. There is no down-migration mechanism. The
  project's actual practice for fixing a mistake is a new numbered migration
  that repairs or supersedes the earlier one (e.g. 078→079, 082→083) — never
  editing a past migration file. This package follows the same convention.

### The last ~20 migrations (065–084) show an active, recurring problem

| Migration | What it did |
|---|---|
| 065 | Fixed `JOB_WORK_TRANSFER_OUT`/`RETURN_IN` hardcoding `CURRENT_DATE` instead of the real business date |
| 066–069 | Repeated redefinitions of `edit_job_work_order()` to stop it from destroying/duplicating return and transfer lines on edit |
| 070–071 (×2), 078–080, 082–083 | One-off named data repairs for *specific* reference numbers (`JW-MRQC6HY0-TSUN`, `JW-MSA5JKMM-FEG0`) — duplicate/misdated ledger rows found and hand-fixed |
| 072 | Fixed cancel-entry dates defaulting to `CURRENT_DATE` |
| 073, 077 | Backfilled ledger rows that were missing entirely for 2024-era transactions |
| 074 | Changed purchase/dispatch cancellation from "insert a reversing row" to "delete the ledger rows outright" |
| 075 | Same outright-delete treatment extended to dispatch purge |
| 084 | The CR00700 duplicate-`PURCHASE_CANCEL` repair that motivated this project |

**Conclusion**: this is not a one-off. Roughly one in three of the last 20
migrations exists because `stock_ledger` drifted from the truth and someone
had to find it by hand and write a bespoke SQL repair. That is exactly the
class of problem this module is meant to detect systematically instead.

### New finding: the migration set does not install cleanly on a blank database

Confirmed empirically while building this package's test harness (see
`docs/data-integrity/TEST_MATRIX.md`): running every migration in order
against a fresh, empty Postgres database **fails at
`063_restore_job_work_transfer_ledger.sql`** with
`insert or update on table "stock_ledger" violates foreign key constraint
"stock_ledger_company_id_fkey"`. That migration, and ten others
(`064`, `071_repair_vendor_direct_sale_duplicates`, `073`, `077`, `078`,
`079`, `080`, `082`, `083`, `084`), INSERT or UPDATE rows against hardcoded,
real production UUIDs (specific companies, warehouses, job-work orders
identified by reference number) — they were written as one-off forensic
repairs meant to run exactly once against the already-populated production
database, and never anticipated running against a blank schema. A handful of
earlier migrations (`052`, `053`, `055`, `062`) also embed production UUIDs
but happen not to error on a blank DB, because they're `UPDATE`/`DELETE`
statements that silently affect zero rows when the target doesn't exist —
which is itself fragile, not a real guarantee.

This is a **pre-existing condition**, not something this package introduces,
and this package does not modify any of those migrations (per its own rule:
existing migrations are never altered or renumbered). It is called out here
because it directly affects what "the migrations run successfully on a clean
database" can honestly mean for this project going forward: today, it can
only mean *"a clean database plus the 11 known production-only repairs
skipped"* — not a truly from-scratch install. See
`docs/data-integrity/TEST_MATRIX.md` for the skip list and
`docs/data-integrity/ARCHITECTURE.md` for a Phase-2 recommendation (guard
one-off repairs with existence checks, or move them out of the
auto-applied path) that would let a genuinely blank install succeed again
without touching this package's own migrations.

---

## 2. `stock_ledger` schema (verified, unchanged since 2024-era migration 012)

Defined in `001_initial_schema.sql`, one column addition in `012_stock_ledger_line_ids.sql`.
Final column set — **16 columns, no more**:

```
id, entry_type, company_id, warehouse_id, material_type_id, material_size_id,
size_label, quantity, reference_type, reference_id, reference_number, notes,
entry_date, created_by, created_at, purchase_line_id, sub_purchase_line_id
```

- `quantity` is `DECIMAL(15,3)` — already decimal-safe at the schema level.
  Report/UI code that does client-side arithmetic on these values (see §6)
  is a *display* concern, not a storage concern.
- **No unique constraint of any kind exists on `stock_ledger`.** Nothing at
  the database level prevents two rows from representing the same business
  event. This is the direct, structural cause of the CR00700 defect and of
  most of the repair migrations in §1.
- `reference_id` is a bare `UUID` with no foreign key — it's polymorphic,
  pointing at `purchase_bills`, `dispatch_orders`, `job_work_orders`, or
  `transfers` depending on `reference_type`. There is no database-level way
  to validate it points at something real; that has to be done by an
  application-side join per `reference_type`.
- Indexes: `company_id`, `warehouse_id`, `material_type_id`, `entry_date`,
  `purchase_line_id`, `sub_purchase_line_id`. No index on `reference_id` or
  `(reference_type, reference_id)` — reconciliation queries that need to find
  a source document from a ledger row currently do an unindexed scan pattern
  unless filtered by another column first.

---

## 3. Entry types — 15 allowed, 12 actually produced

The `entry_type` CHECK constraint grew across 5 migrations (001→018→035→036→056).
Final allow-list, cross-referenced against every producer in the codebase:

| entry_type | Sign | Producer | Status |
|---|---:|---|---|
| `PURCHASE_IN` | + | `fn_bill_item_to_ledger()` (latest body: 043) | Live |
| `PURCHASE_CANCEL` | − | `cancel_purchase_bill()` (074), `reverse_purchase_item()` (043) | Live |
| `SALE_OUT` | − | `fn_dispatch_item_to_ledger()` (latest: 062) | Live |
| `SALE_CANCEL` | + | `cancel_dispatch_order()` (074), `edit_dispatch_order()` (062) | Live |
| `JOB_WORK_OUT` | − | `fn_job_work_item_to_ledger()` (latest: 065) | Live |
| `JOB_WORK_RETURN_IN` | + | same trigger (UPDATE branch); also `fn_dispatch_item_to_ledger()` for vendor-direct-sale virtual returns | Live |
| `JOB_WORK_CANCEL` | ± | historically `delete_job_work_order()` before 061 switched to outright delete | **Historical only — no longer produced going forward** |
| `JOB_WORK_OUTPUT_IN` | + | `fn_job_work_output_item_to_ledger()` (latest: 076) | Live |
| `JOB_WORK_TRANSFER_OUT` | − | `fn_job_work_item_to_ledger()` | Live |
| `JOB_WORK_TRANSFER_IN` | + | same trigger | Live |
| `TRANSFER_OUT` | − | `fn_transfer_item_to_ledger()` (latest: 043) | Live |
| `TRANSFER_IN` | + | same trigger | Live |
| `VENDOR_RETURN_IN` | + (label only) | **none found** | **Dead — reserved, never posted** |
| `ADJUSTMENT_IN` | + (label only) | **none found** | **Dead — reserved, never posted** |
| `ADJUSTMENT_OUT` | − (label only) | **none found** | **Dead — reserved, never posted** |

Implication for reconciliation rules: any rule that iterates "all entry
types" must not assume `VENDOR_RETURN_IN`/`ADJUSTMENT_IN`/`ADJUSTMENT_OUT`
occur — if one ever does appear in the data, that itself is worth flagging
(manual DB surgery or an unexpected new code path), not silently accepted.

There is also a **synthetic, display-only type**, `VENDOR_DIRECT_SALE`,
fabricated client-side in `item-ledger/page.tsx` by merging a
`JOB_WORK_RETURN_IN` (note = `'Vendor direct sale — virtual return'`) with its
paired `SALE_OUT`. It is never written to `stock_ledger` and must never be
treated as a real entry type by any rule.

---

## 4. Ledger-writing functions — latest active body per function

Triggers themselves were created once and never redropped; only the function
bodies they call have been redefined repeatedly. The **latest** definition is
the one that matters for reconciliation logic:

| Function | Fires from | Latest defining migration |
|---|---|---|
| `fn_bill_item_to_ledger()` | trigger on `purchase_bill_items` INSERT | 043 |
| `fn_dispatch_item_to_ledger()` | trigger on `dispatch_items` INSERT | 062 |
| `fn_transfer_item_to_ledger()` | trigger on `transfer_items` INSERT | 043 |
| `fn_job_work_item_to_ledger()` | trigger on `job_work_items` INSERT/UPDATE | 065 |
| `fn_job_work_output_item_to_ledger()` | trigger on `job_work_output_items` INSERT | 076 |
| `fn_bill_item_deleted()` | trigger on `purchase_bill_items` DELETE | 072 |
| `cancel_purchase_bill()` | RPC from `/api/bills/[id]/cancel` | 074 |
| `cancel_dispatch_order()` | RPC from `/api/dispatch/[id]/cancel` | 074 |
| `purge_cancelled_bill()` | RPC from `/api/bills/[id]/purge` | 054 |
| `purge_cancelled_dispatch()` | RPC from `/api/dispatch/[id]/purge` | 075 |
| `reverse_purchase_item()` | called only from inside `fn_bill_item_deleted()` | 043 |
| `edit_dispatch_order()` | RPC from `/api/dispatch/[id]/save-edit` | 062 |
| `delete_job_work_order()` | RPC from `/api/jobwork/[id]/delete` | 061 |
| `edit_job_work_order()` | RPC from `/api/jobwork/[id]/save-edit` | 081 |
| `delete_job_work_transfer()` | RPC from `/api/jobwork-transfers/[id]/delete` | 061 (cascade logic added 060, authoritative body 061) |
| `preview_job_work_transfer_deletion()` | read-only RPC | 060 |

**Convergent behavioral pattern (054, 061, 074, 075):** every cancel/purge/
delete path was migrated over time from "insert a reversing row" to **"delete
the original ledger rows outright."** The one documented, deliberate
exception: `delete_job_work_order()` / `edit_job_work_order()` explicitly
exclude `JOB_WORK_TRANSFER_OUT` rows from deletion, because that row's paired
`JOB_WORK_TRANSFER_IN` lives on a *different* job work order (the transfer
destination) that isn't part of the current operation — deleting it would
silently orphan the pair and inflate stock at the destination vendor.

This matters for REC-007 (reversal mismatch): "reversal" in this codebase
means two different things depending on era — a negative offsetting row
(pre-074, still present in historical data) or an outright delete (074+,
current behavior, leaves no ledger trace of the reversal itself). A rule that
only looks for `*_CANCEL` rows will miss cancellations that happened via
outright delete, because there is nothing to find — the correct check there
is "does the source document say cancelled, but its would-be ledger rows are
completely absent," which is closer to REC-002/REC-003 territory than REC-007.

---

## 5. API routes that touch `stock_ledger`

Every route below uses `hasuraRunSql()` (raw SQL via Hasura's `run_sql`
endpoint) or `hasuraQuery()` (GraphQL), gated by `verifySessionCookie()` plus
a per-route allowed-roles set.

| Route | Method | Ledger effect |
|---|---|---|
| `api/bills/[id]/cancel` | POST | RPC `cancel_purchase_bill` — deletes ledger rows |
| `api/bills/[id]/submit` | POST | None directly — flips `purchase_bills.status`; ledger rows were already posted when items were inserted (draft or not — see risk below) |
| `api/bills/[id]/purge` | POST | RPC `purge_cancelled_bill` — archives + deletes |
| `api/bills/[id]/save-edit` | POST | Deletes removed lines (fires `fn_bill_item_deleted` → `PURCHASE_CANCEL`), inserts new lines (fires `fn_bill_item_to_ledger` → `PURCHASE_IN`) |
| `api/dispatch/[id]/cancel` | POST | RPC `cancel_dispatch_order` — deletes |
| `api/dispatch/[id]/save-edit` | POST | RPC `edit_dispatch_order` |
| `api/dispatch/[id]/purge` | POST | RPC `purge_cancelled_dispatch` |
| `api/jobwork/[id]/delete` | POST | RPC `delete_job_work_order` |
| `api/jobwork/[id]/save-edit` | POST | RPC `edit_job_work_order` |
| `api/jobwork-transfers/[id]/delete` | POST | RPC `delete_job_work_transfer` (recursive) |
| `api/jobwork-transfers/[id]/preview-delete` | GET/POST | Read-only |
| `api/warehouses/merge` | POST | **Direct** `UPDATE stock_ledger SET warehouse_id=...` inside a hand-written multi-statement SQL block |
| `api/stock/ledger-entries` | POST | **Direct** `DELETE FROM stock_ledger WHERE id IN (...)` — admin/developer only |
| `api/stock/reconcile` | POST | **Direct** `INSERT INTO stock_ledger` — see §6 |
| `api/stock/verify` | GET | Read-only diagnostics — see §6 |

**Risk found, not previously known**: `fn_dispatch_item_to_ledger()` checks
`IF v_dispatch.status = 'draft' THEN RETURN NEW; END IF;` before posting
`SALE_OUT` — draft dispatches correctly don't post. **`fn_bill_item_to_ledger()`
has no equivalent check.** Since purchase bills support a `draft` status
(migration 024) and bill line items are inserted via a direct GraphQL
mutation (not gated through an API route), a bill sitting in `draft` can post
real `PURCHASE_IN` rows before `/api/bills/[id]/submit` is ever called. This
is exactly the shape of bug REC-002/REC-015 are designed to catch (a draft
document posting to the ledger prematurely, or a submitted document whose
header total doesn't match its now-doubly-posted lines). **This audit does
not claim this bug has actually occurred in production data** — only that the
code path allows it and it should be an early reconciliation-rule target.

Bill/transfer/job-work **creation** (initial line-item INSERT) happens via
direct GraphQL mutations from page components, not through `src/app/api/**`
routes — API routes only cover the cancel/edit/delete/purge lifecycle.

---

## 6. Existing reconciliation tooling — confirmed narrow

### `POST /api/stock/reconcile`
Finds "phantom" purchase-line balances: a `purchase_line_id` with a net-positive
ledger sum but no matching row left in `purchase_bill_items`, and **directly
inserts** a `PURCHASE_CANCEL` row to zero it out. **Purchase-only** — never
looks at dispatch, job work, or transfer lines. This is a mutating endpoint,
not a read-only check, and it makes an irreversible decision (insert a
correcting entry) with no approval step and no audit trail beyond the row's
own `notes` field. This is precisely the pattern (§11 of the assignment)
this module must not repeat for new rules.

### `GET /api/stock/verify`
Four read-only checks over a date window:
1. Category totals: source-table sums vs. ledger sums per category, tolerance `0.001`.
2. Explained residuals: rows whose order was cancelled outside the query window.
3. Stale records: `reference_id` resolves to nothing in either the live or archive table.
4. **Duplicate rows** — confirmed exactly as suspected:
   ```sql
   WHERE entry_type IN ('PURCHASE_IN', 'SALE_OUT', 'JOB_WORK_OUT')
   GROUP BY reference_type, reference_id, reference_number, entry_type, purchase_line_id, size_label
   HAVING count(*) > 1
   ```
   This is the gap that let the CR00700 duplicate `PURCHASE_CANCEL` through —
   `PURCHASE_CANCEL` is not in that `IN (...)` list, and neither is
   `JOB_WORK_RETURN_IN`, despite migration history showing duplicate-posting
   bugs specifically hit vendor-direct-sale returns (062, 071) as well as
   cancellations (084).

Both endpoints exist; neither has a persistent run/exception history, a
severity model, a fingerprint/dedup mechanism across repeated scans, or a
review-and-approval workflow before anything is written. That gap is what
Phase 1 of this module fills, in read-only form first.

---

## 7. Current report balance formulas (for canonical-layer comparison later)

| Location | Formula |
|---|---|
| `reports/item-ledger/page.tsx` | Opening = `SUM(quantity WHERE entry_date < from)`; running balance accumulated row-by-row through the period; Closing = final running value. All entry types now included unconditionally (fixed 2026-08-08, this session, prior to this module). |
| `reports/item-ledger` vendor balance | `vendorOpening = -SUM(quantity WHERE entry_date < from AND entry_type IN VENDOR_MOVEMENT_TYPES)`, then decremented per row — sign-inverted from the ledger's own convention because "vendor stock" is the mirror of "warehouse stock." |
| `lib/stockLedger.ts` | `VENDOR_MOVEMENT_TYPES = [JOB_WORK_OUT, JOB_WORK_RETURN_IN, JOB_WORK_CANCEL, JOB_WORK_TRANSFER_OUT, JOB_WORK_TRANSFER_IN]` — deliberately excludes `JOB_WORK_OUTPUT_IN` (posts against the *output* material, not the raw material held at the vendor). |
| `reports/stock-statement/page.tsx` | Same Opening/Period/Closing pattern, separately for warehouse and vendor balances. |
| `dashboard/useDashboardData.ts` | Reads DB view `v_current_stock` directly (`SUM(quantity)` grouped by company/warehouse/material/size) — no client accumulation. |
| `jobwork/new/page.tsx` (Job Work input picker) | `Σ stock_ledger.quantity` per `purchase_line_id`, **all-time, all entry types**, filtered client-side to `> 0` — this is the calculation the CR00700 defect broke. |
| `v_stock_at_vendors` view (latest body: 056) | `pending_quantity = SUM(quantity_sent − quantity_received − quantity_transferred_out)` computed from `job_work_items` directly, **not from `stock_ledger`** — a source-table-derived balance that can independently drift from the ledger's own vendor total. This divergence is itself a natural target for REC-018. |

**Key finding for the canonical layer design (§7 of architecture doc):** there
are already at least two independently-computed notions of "vendor stock" in
this codebase — one from `stock_ledger` (via `VENDOR_MOVEMENT_TYPES`) and one
from `job_work_items` columns directly (`v_stock_at_vendors`). They should
agree, and don't have a check that they do. That is a natural first
target for the canonical-layer comparison step (§7 of the assignment).

---

## 8. Conventions found (and their absence)

- **No `AGENTS.md`, no `CONTRIBUTING.md`** anywhere in the repository.
- `README.md` is stale — describes a Supabase migration that has already
  completed in the actual code (the app runs fully on Hasura/Postgres).
- The closest thing to a stated verification convention is in `AI_Handoff.md`
  (a running task log, not a formal doc): `npx tsc --noEmit` is the working
  verification step; `npm run lint` is **currently broken** (`react/display-name`
  ESLint plugin incompatible with ESLint 10.4.0) — a pre-existing condition,
  not something this package introduces or is expected to fix.
- Migration execution: `scripts/desktop/migrate.mjs` applies
  `supabase/migrations/*.sql` in filename-sorted order, tracks applied files
  in `schema_migrations(filename PK, applied_at)`, and runs each migration in
  its own transaction. Forward-only, as noted in §1.
- `package.json` has **no `test` script and no test framework** of any kind
  (`jest`/`vitest`/`playwright`/`@testing-library` all absent). This package
  introduces the first automated tests in the repository — see
  `docs/data-integrity/TEST_MATRIX.md`.
- The repo **does** depend on `embedded-postgres` (already used by
  `scripts/desktop/` for the offline/desktop build). This package reuses that
  dependency to run real migrations against a throwaway local Postgres
  instance for testing, since no separate staging database is available in
  this environment and production must not be touched (see
  `docs/data-integrity/TEST_MATRIX.md` for how this was actually exercised).

---

## 9. Risks this audit surfaces for the reconciliation module's design

1. **No unique constraint on `stock_ledger`** → REC-001 (duplicate detection)
   cannot rely on a database constraint catching new duplicates; it must be a
   scheduled/on-demand scan, and a future-phase idempotency key (§12 of the
   assignment) is the real fix, not retrofitted uniqueness on 86 migrations
   of historical data.
2. **Two different "reversal" shapes in history** (insert-negative-row vs.
   outright-delete, split at migrations 054/061/074/075) → REC-007 must
   handle both eras, and REC-002/REC-003 (missing/orphan) must not
   mistake a correctly-outright-deleted cancellation for a missing posting.
3. **Draft purchase bills may post to the ledger before submission** → new
   finding, candidate for REC-002/REC-015, not yet confirmed against real
   data (this audit is code-only, not a data query).
4. **Two independently-computed vendor-stock balances** (`stock_ledger` via
   `VENDOR_MOVEMENT_TYPES` vs. `job_work_items`-derived `v_stock_at_vendors`)
   → REC-018 target.
5. **`reference_id` has no FK and no supporting index** → REC-003 (orphan
   detection) queries will need per-`reference_type` joins against the
   correct live/archive table pair, mirroring the existing pattern in
   `reports/item-ledger/page.tsx`'s `findOrphanedReferences()`, and should
   add an index (see `docs/data-integrity/ARCHITECTURE.md` §Indexes) — but
   only after confirming query plans need it, per the assignment's
   performance-section instruction.
6. **`VENDOR_RETURN_IN`/`ADJUSTMENT_IN`/`ADJUSTMENT_OUT` are schema-legal but
   never produced** → if reconciliation ever finds one, that is itself
   noteworthy (flagged, not silently normalized).
7. **Zero existing test coverage** → every reconciliation rule implemented in
   this package ships with its own test using synthetic data (see
   `TEST_MATRIX.md`); there is no existing suite to integrate with.
