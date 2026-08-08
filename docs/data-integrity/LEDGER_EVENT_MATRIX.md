# WareCore Ledger Event Matrix

Grounded in `docs/data-integrity/CURRENT_STATE_AUDIT.md`. This is the reference
table every reconciliation rule is written against. "Paired event" means the
event that should exist alongside this one for the business action to be
complete (e.g. a transfer's OUT leg is paired with its IN leg).

`VENDOR_RETURN_IN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT` are included because
they're schema-legal, but are marked **dead** — no code path produces them.

| Business action | Source table | Source line table | Ledger type | Sign | Warehouse effect | Vendor effect | Paired event | Posting function (latest) |
|---|---|---|---:|---:|---|---|---|---|
| Purchase received | `purchase_bills` | `purchase_bill_items` | `PURCHASE_IN` | + | + stock in | none | none (terminal inflow) | `fn_bill_item_to_ledger()` (043) |
| Purchase bill cancelled / line removed | `purchase_bills` | `purchase_bill_items` (deleted) | `PURCHASE_CANCEL` | − | − stock (reverses IN) | none | the `PURCHASE_IN` it reverses | `cancel_purchase_bill()` (074) / `fn_bill_item_deleted()` (072) / `reverse_purchase_item()` (043) |
| Sale / dispatch | `dispatch_orders` | `dispatch_items` | `SALE_OUT` | − | − stock out | none | none (terminal outflow), unless vendor-direct-sale (see below) | `fn_dispatch_item_to_ledger()` (062) — no-ops while `dispatch_orders.status = 'draft'` |
| Sale cancelled | `dispatch_orders` | `dispatch_items` | `SALE_CANCEL` | + | + stock (reverses OUT) | none | the `SALE_OUT` it reverses | `cancel_dispatch_order()` (074) / `edit_dispatch_order()` (062) |
| Vendor-direct sale (dispatch fulfilled straight from vendor stock, no warehouse touch) | `dispatch_orders` + `job_work_orders` | `dispatch_items` | `JOB_WORK_RETURN_IN` (virtual, note = `'Vendor direct sale — virtual return'`) **+** `SALE_OUT`, same date, exactly offsetting | + then − (nets to 0 warehouse effect) | net 0 | − at vendor | each other — must always appear as an exactly-offsetting same-date pair | `fn_dispatch_item_to_ledger()` (062) |
| Job Work material issued to vendor | `job_work_orders` | `job_work_items` | `JOB_WORK_OUT` | − | − stock out (leaves warehouse) | + held at vendor | its eventual `JOB_WORK_RETURN_IN`/`JOB_WORK_TRANSFER_OUT`/`JOB_WORK_OUTPUT_IN` | `fn_job_work_item_to_ledger()` (065), INSERT branch |
| Job Work raw material returned by vendor | `job_work_orders` | `job_work_items` (`quantity_received` increases) | `JOB_WORK_RETURN_IN` | + | + stock in (returns to warehouse) | − held at vendor | the `JOB_WORK_OUT` it partially/fully closes | `fn_job_work_item_to_ledger()` (065), UPDATE branch |
| Job Work order cancelled (pre-061 era) | `job_work_orders` | `job_work_items` | `JOB_WORK_CANCEL` | ± | net-zero vs. the `JOB_WORK_OUT` | net-zero vs. held-at-vendor | the `JOB_WORK_OUT` it reverses | **historical only** — `delete_job_work_order()` (061+) now deletes rows outright instead |
| Job Work finished output received | `job_work_output_items` | `job_work_output_items` | `JOB_WORK_OUTPUT_IN` | + | + stock in, but as the **output item**, not the raw material | none (output items aren't "at vendor") | traces back to source `job_work_items`/`purchase_bill_items` via `source_job_line_id`/`source_purchase_line_ids` (set by `fn_job_work_output_item_set_source_lines()`) — not a simple 1:1 reversal pair | `fn_job_work_output_item_to_ledger()` (076) |
| Job Work material transferred to another vendor | `job_work_orders` (source) → `job_work_orders` (destination) | `job_work_items` (`quantity_transferred_out` increases on source; new line with `is_transfer_line=true` on destination) | `JOB_WORK_TRANSFER_OUT` (source order) + `JOB_WORK_TRANSFER_IN` (destination order) | − then + | net 0 (never touches warehouse — vendor-to-vendor) | − at source vendor, + at destination vendor | each other — cross-order pair, audited separately via `job_work_transfers`/`job_work_transfer_items` | `fn_job_work_item_to_ledger()` (065) — OUT on UPDATE branch of source, IN on INSERT branch of destination |
| Inter-warehouse transfer | `transfers` | `transfer_items` | `TRANSFER_OUT` (source warehouse) + `TRANSFER_IN` (destination warehouse) | − then + | − at source warehouse, + at destination warehouse | none | each other — both legs from the same `transfer_items` row, same `transfers.id` | `fn_transfer_item_to_ledger()` (043) — both legs fire from one INSERT trigger |
| Vendor return of goods (reserved, distinct from Job Work return) | — | — | `VENDOR_RETURN_IN` | + (by label) | + stock in | n/a | n/a | **dead — no producer** |
| Manual stock adjustment, inward | — | — | `ADJUSTMENT_IN` | + (by label) | + stock in | none | none | **dead — no producer** |
| Manual stock adjustment, outward | — | — | `ADJUSTMENT_OUT` | − (by label) | − stock out | none | none | **dead — no producer** |
| Display-only merge (never in `stock_ledger`) | n/a | n/a | `VENDOR_DIRECT_SALE` (client-fabricated) | n/a | n/a | n/a | represents the `JOB_WORK_RETURN_IN` + `SALE_OUT` pair above, merged for readability | `reports/item-ledger/page.tsx` display logic only |

## Notes for rule authors

- **Sign convention is not globally "in = positive."** `JOB_WORK_TRANSFER_IN`
  is positive at the *destination* vendor but the same business event is
  negative (`JOB_WORK_TRANSFER_OUT`) at the *source* vendor — both rows exist
  independently in `stock_ledger` with no shared `reference_id` linking them
  directly to each other (they're each posted against their own order's
  `reference_id`); the link between the two legs lives in
  `job_work_transfers`/`job_work_transfer_items`, matched by
  order + line + quantity, not by a ledger-side foreign key. REC-008 (transfer
  pairs, for `TRANSFER_OUT`/`TRANSFER_IN`) can match by `transfers.id`
  directly. REC-009's job-work-to-vendor transfer check needs the
  `job_work_transfers` audit table, not just `stock_ledger`.
- **`JOB_WORK_OUTPUT_IN` must never be netted against `JOB_WORK_OUT`/
  `JOB_WORK_RETURN_IN` as if it were a return of the same material.** It's a
  different item (the output/finished product), traced via
  `source_job_line_id`/`source_purchase_line_ids`, not a quantity reversal of
  the raw material sent. This is called out explicitly because REC-009 in the
  assignment warns against "adding unlike material items together merely to
  force a zero balance" — this is the concrete case that warning is about.
- **Vendor-direct-sale pairs must always be evaluated together.** A
  `JOB_WORK_RETURN_IN` with notes `'Vendor direct sale — virtual return'`
  that does *not* have an exactly-offsetting same-date `SALE_OUT` (or vice
  versa) is a REC-007/REC-008-shaped defect, not a normal partial return.
- **Effective date vs. posting date**: `entry_date` is meant to be the
  *business* date (bill date, dispatch date, transfer date, job work dispatch
  date, return-received date). `created_at` is when the row was technically
  written to the database, which for backfilled/migrated history (see audit
  §1) can be years later than `entry_date`. REC-011/REC-012 must compare
  against `entry_date`, never `created_at`, for business-date correctness —
  `created_at` is only useful for detecting *when a repair was made*, not
  *when the business event happened*.
