# Repair Governance

**Status in this release: foundation only. No repair can execute.** This
document describes the intended workflow for Phase 2+ and exactly what
exists today so nobody mistakes "the tables exist" for "repair works."

## What exists today

- `repair_batches` (085): a proposal record — exception, proposed action,
  proposal JSON, before/after snapshots, status, requester/approver/executor
  fields, execution/validation results, rollback info.
- `repair_audit_rows` (085): before/after image per affected row, linked to
  a batch. Never populated in this release — nothing writes to it.
- `POST /api/data-integrity/repair-proposals`: creates a `repair_batches`
  row in `DRAFT` status. That is the *only* write this route performs.
- `PATCH`/execution endpoints for repair batches: **do not exist.** There is
  no route, function, or UI control anywhere in this codebase that can move
  a `repair_batches` row past `DRAFT`/`PENDING_APPROVAL`, or that touches
  `stock_ledger` on a repair's behalf.
- `reconciliation_settings.repair_execution_enabled`: `FALSE` and unused —
  no code checks it yet, because there's nothing for it to gate. It exists
  now so enabling Phase 2 execution is one audited flag flip, not a
  redeploy.

## Status lifecycle (repair_batches.status)

```
DRAFT → PENDING_APPROVAL → APPROVED → EXECUTING → EXECUTED
                         ↘ REJECTED              ↘ EXECUTION_FAILED → ROLLED_BACK
```

Only `DRAFT` and `PENDING_APPROVAL` are reachable in this release (via
`POST /api/data-integrity/repair-proposals`, which inserts as `DRAFT`).
Everything from `APPROVED` onward is Phase 2 design, not Phase 2 code.

## Maker-checker (already enforced at the database level)

```sql
CONSTRAINT chk_repair_batches_maker_checker
  CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by)
```

Whoever proposes a repair cannot also be recorded as its approver — enforced
by a `CHECK` constraint, not just application logic, so it can't be bypassed
by a direct SQL statement either. `CAN_APPROVE_REPAIR` in
`src/lib/dataIntegrity/auth.ts` additionally restricts approval to
`admin`/`developer`, matching `CAN_PROPOSE_REPAIR`.

## Intended Phase 2 execution flow (design, not implementation)

1. **Propose**: `POST /api/data-integrity/repair-proposals` (exists) —
   captures the exception's full state as `before_snapshot` at proposal
   time.
2. **Review**: a human reads the exception detail page's evidence,
   chronological movement, and the proposal's expected after-state.
3. **Approve**: a *different* admin/developer than the requester flips the
   batch to `APPROVED` (route to be built — not present today).
4. **Execute** (Phase 2, not built): a reviewed, typed database function
   per repair type — never arbitrary SQL generated in the browser, per the
   assignment's explicit instruction. Runs inside one transaction:
   1. Copy the full row(s) being changed into `repair_audit_rows` (before image).
   2. Perform the repair (see "Repair types" below).
   3. Record the after image into `repair_audit_rows`.
   4. Re-run the originating rule's `fn_reconcile_rec_XXX()` scoped to the
      same fingerprint — if it still fires, `ROLLBACK` the whole
      transaction. The repair only commits if it actually fixed what it
      claimed to fix.
5. **Re-run reconciliation** for the affected scope, confirming
   `reconciliation_exceptions.status` transitions to `RESOLVED` on its own
   via the fingerprint upsert (not by manually closing it).

## Repair types (design vocabulary, from the assignment — none implemented)

- Create missing ledger event
- Add linked compensating entry
- Correct metadata
- Relink source document
- Archive a confirmed technical duplicate
- Recalculate derived header total

**Deliberately absent from this list, and never to be added as a "repair
type": unrestricted manual editing of ledger quantities, or physical
deletion as a default repair action.** If a proven technical duplicate must
eventually be removed (e.g. a REC-001 `CONFIRMED` duplicate like CR00700's),
the assignment's own procedure applies — copy the full row to
`repair_audit_rows` first, link it to a batch, record reason and approvers,
capture pre-repair balances, execute in one transaction, re-run
reconciliation, and roll back if the expected balance isn't achieved. This
is intentionally slower than the direct-SQL approach used for the CR00700
fix itself (migration 084, applied by hand under human review) — the whole
point of this module is to make that kind of fix routine, evidenced, and
reversible instead of ad hoc.

## Why direct production SQL fixes should be avoided going forward

Migration 084 (the CR00700 repair) was correct *and* fully manual: a human
found the row, wrote a targeted `DELETE`, and verified the result by hand.
That doesn't scale, and it leaves no structured record of *why* — no
fingerprint, no before/after snapshot, no linkage to a detection rule. The
migration history in `CURRENT_STATE_AUDIT.md` §1 shows roughly a third of
recent migrations exist for exactly this reason. This module's job is to
turn "find it by hand, fix it by hand, hope you remembered everything" into
"the rule found it, the evidence is preserved, the fix is reviewed before it
runs, and re-running the rule is the proof it worked."
