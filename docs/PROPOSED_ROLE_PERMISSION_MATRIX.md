# Proposed Role/Permission Matrix

Status: **PROPOSAL — not yet implemented.** Nothing in this document has been
applied to code. It extends the pattern already used successfully in 35 of
55 API routes (`ALLOWED_ROLES` sets, e.g. `src/app/api/bills/[id]/cancel`,
`src/app/api/dispatch/[id]/save-edit`, `src/lib/dataIntegrity/auth.ts`) to
the 16 sidebar modules and their page-level routes, which today only check
"is logged in," not role. See `docs/WARECORE_REDESIGN_AUDIT.md` §4–5 and
`docs/ROUTE_AND_FEATURE_MATRIX.md` for the underlying inventory.

The company_code-based "custom roles" system (`custom_roles` /
`role_permissions` tables, `/admin/roles` UI) is **not** part of this
proposal — see the separate finding that it's currently unreachable
(`user_profiles.role` can't hold a custom role code) and unenforced (nothing
reads `role_permissions`). This proposal works entirely within the 6 fixed
roles already in the `user_profiles_role_check` constraint: `developer`,
`admin`, `company_manager`, `warehouse_manager`, `sales_manager`,
`billing_staff`.

## Capability tiers observed in existing code (precedent, not proposed — already true today)

| Tier | Roles | Where already enforced |
|---|---|---|
| **System admin** — backup export/restore, direct ledger row deletion, warehouse merge, data-integrity rule management/repair approval | `admin`, `developer` | `api/backup/*` (just fixed), `api/stock/ledger-entries`, `api/warehouses/merge`, `CAN_MANAGE_RULES`/`CAN_PROPOSE_REPAIR`/`CAN_APPROVE_REPAIR` |
| **Destructive transaction ops** — cancel/delete/purge bills, dispatch, job work, transfers | `admin`, `developer`, `company_manager` (+ `billing_staff` for bill/dispatch *cancel* specifically, + `sales_manager` for dispatch *cancel* specifically — purge is stricter, excludes both) | `api/bills/[id]/{cancel,purge,save-edit}`, `api/dispatch/[id]/{cancel,purge,save-edit}`, `api/jobwork/[id]/{delete,save-edit}`, `api/jobwork-transfers/[id]/delete` |
| **Create/edit transactional docs** | `admin`, `developer`, `company_manager`, `billing_staff` (+ `sales_manager` for dispatch) | same routes as above |
| **Data Integrity view/run** | view: `admin`, `developer`, `company_manager`, `billing_staff`; run scan: same minus `billing_staff` | `src/lib/dataIntegrity/auth.ts` |
| **Role administration** | `admin`, `company_manager` (⚠️ excludes `developer` — flagged below) | `admin/roles/layout.tsx` |

## Decisions confirmed (2026-08-12)

- **`warehouse_manager` scope**: confirmed as proposed below — view
  everywhere, create/edit on Transfers and Job Work, view-only on
  Inventory/Movements. (Previously zero elevated permission anywhere in the
  code — not in any `ALLOWED_ROLES` or `CAN_*` set.)
- **`developer` + role administration**: confirmed — `developer` added to
  `admin/roles/layout.tsx`'s `ALLOWED_ROLES` (already applied), matching
  every other system-admin-tier gate in the codebase.

## Proposed matrix, by sidebar module

`V` = view/read, `C` = create, `E` = edit, `X` = cancel/delete/purge (destructive)
— cells combine what already exists (unchanged) with what's proposed to fill in (marked *NEW*).

| Module | developer | admin | company_manager | warehouse_manager | sales_manager | billing_staff |
|---|---|---|---|---|---|---|
| Dashboard | V | V | V | V | V | V |
| Admin (companies/warehouses/suppliers/customers/materials/items/tax-rates) | *NEW* full | *NEW* full | *NEW* full | — | — | — |
| Admin → Users | *NEW* full | *NEW* full | *NEW* full | — | — | — |
| Admin → Roles | full (add, per open question above) | full | full | — | — | — |
| Backup & Restore | full (already fixed) | full (already fixed) | — | — | — | — |
| Data Integrity | full | full | V + run scan | — | — | V only |
| Purchase Entry (bills) | full | full | full | — | — | C/E + cancel (not purge) |
| Purchase Cancellations | V (archive) | V | V | — | — | V |
| Accounts | *NEW* V | *NEW* V | *NEW* V | — | — | *NEW* full |
| Inventory | *NEW* V | *NEW* V | *NEW* V | *NEW* V | *NEW* V | *NEW* V |
| Movements | *NEW* V | *NEW* V | *NEW* V | *NEW* V | *NEW* V | *NEW* V |
| Transfers | *NEW* full | *NEW* full | *NEW* full | *NEW* C/E (per open question) | — | — |
| Job Work | full | full | full | *NEW* C/E (per open question) | — | — |
| Job Work Transfers | full | full | full | *NEW* V (per open question) | — | — |
| Job Work Cancellations | V (archive) | V | V | — | — | — |
| Sale Entry (dispatch) | full | full | full | — | C/E + cancel (not purge) | C/E + cancel (not purge) |
| Sale Cancellations | V (archive) | V | V | — | V | V |
| Reports (all 12) | *NEW* V | *NEW* V | *NEW* V | *NEW* V | *NEW* V | *NEW* V |
| Profile | own account only, all roles | | | | | |

## What "implementing this" would actually mean

1. Add a small shared helper (e.g. `requireRole(session, allowedRoles)` in
   `src/lib/auth/`) so every gate is one line instead of hand-rolled
   `ALLOWED_ROLES` sets copy-pasted per file (35 near-identical copies exist
   today — worth consolidating regardless of what the matrix ends up saying).
2. Add role checks to the ~15 page-level route groups that currently have
   none, per the table above (mostly `layout.tsx` additions, matching the
   `data-integrity/layout.tsx` pattern already in the codebase).
3. Add role checks to the API routes backing "Admin" (companies/warehouses/
   suppliers/customers/materials/items/tax-rates CRUD) and "Accounts" — these
   don't currently exist as role-gated at all, at either layer.
4. This is a real behavior change for real users — plan a rollout (e.g. log
   what *would* be denied for a period before actually denying) rather than
   flipping it on everywhere at once, since a wrong row in this matrix could
   lock someone out of work they legitimately do today.

Nothing above has been implemented. This is the artifact for your review —
correct the matrix (especially the `warehouse_manager` and `developer`/roles
questions), and I'll scope the actual implementation as its own checkpoint.
