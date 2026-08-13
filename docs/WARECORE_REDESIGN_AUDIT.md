# WareCore Redesign — Phase 0 Audit

Date: 2026-08-12
Scope: Read-only audit of `c:\Users\Public\Projects\warecore` ahead of a planned multi-phase UI/UX redesign (two visual modes, icon system, purchase-import review, data-integrity module, Excel exports, etc.). No code was modified to produce this report. See the companion file `docs/ROUTE_AND_FEATURE_MATRIX.md` for the full per-route table.

---

## 1. Detected stack & versions

| Layer | Detail |
|---|---|
| Framework | Next.js 16.2.6, App Router, Turbopack build |
| UI runtime | React 19.2.6 / React DOM 19.2.6 |
| Language | TypeScript 6.0.3 (`tsc --noEmit` used for typecheck, no separate build-time type gate beyond Next's own) |
| Styling | Tailwind CSS 4 (`@tailwindcss/postcss`), no component library (no MUI/Chakra/etc.) — hand-rolled Tailwind class strings everywhere |
| Icons | `lucide-react` 1.16.0 present as a dependency but used in only **8 files**; the rest of the app (**100 files**, ~268 occurrences) renders raw emoji characters as icons (see §9) |
| Linting | ESLint 10.4.0 + `eslint-config-next` 16.2.6 — **currently crashes**, see §12 |
| Testing | Vitest 4.1.10 — 13 test files exist, all currently fail to collect (0 tests executed), see §12 |
| Backend/data | Hasura GraphQL Engine (admin-secret access only, no user-scoped permissions) over Postgres; Supabase (`@supabase/supabase-js` + `@supabase/ssr`) used for `auth.users` FK references and storage, not for its own RLS-driven data access from the app |
| Excel export | `exceljs` 4.4.0 — already used across Reports and several list screens |
| AI | `@anthropic-ai/sdk` 0.110.0 — powers the "Copilot" chat button (in `src/components/ai/*`), currently 2 tools per project memory |
| Auth libs | `bcryptjs`, `jsonwebtoken` (custom JWT session, not NextAuth), `nodemailer` (password-reset email) |
| Desktop/offline | `embedded-postgres` 18.4.0-beta.17 + `pg` — a `LOCAL_MODE` code path (`src/lib/localdb/*`) lets the whole app run against a bundled local Postgres instead of remote Hasura, for `npm run start:desktop` |
| Mobile wrapper | `capacitor.config.ts` present at repo root (`appId: in.warecore.app`, `webDir: out`) — a Capacitor-wrapped mobile build exists as a *third* packaging target, separate from and orthogonal to the Classic/Modern/existing chrome question below |
| PWA | `public/manifest.json` + `public/sw.js` + `public/icons/icon-*.png` (72–512px) — a real, WareCore-branded PWA icon set already exists |
| Package manager | npm (package-lock.json present); scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test` (`vitest run`), `seed:dev`, `start:desktop` |

## 2. Package manager & commands

Standard `npm run <script>`. No monorepo/workspaces. Key scripts as listed above; there is no `format`/`prettier` script, no Storybook, no CI config file discovered in-repo (not checked exhaustively for `.github/workflows`, out of scope but worth a follow-up look before Phase 1).

## 3. Application routes & layouts

- **86** `page.tsx` files found under `src/app` (Glob timed out on this large repo; `find` was used instead — see `docs/ROUTE_AND_FEATURE_MATRIX.md` for the full enumeration). This is more than the 82 quoted in the original context — the delta is accounted for by newer screens added since that count was taken: `bills/import` + `bills/import/[batchId]` (purchase-import workflow), the `data-integrity/*` tree (6 pages), and `jobwork-transfer-cancellations` + `jobwork-transfer-cancellations/[id]` (a screen reachable from Job Work Transfers that isn't its own sidebar item).
- Two route-group layouts:
  - `src/app/(app)/layout.tsx` — the authenticated shell (sidebar, header, mobile bottom nav, Copilot mount). Client component.
  - `src/app/(website)/page.tsx` — the public marketing home at `/` (Server component, no shell).
- Plus standalone, shell-less routes: `/login`, `/login/forgot-password`, `/login/reset-password`, `/setup`, `/offline`, and the root `/page.tsx` (a redirect/landing stub — 8 lines).
- `next build` confirms the router's own accounting: 68 static + dynamic app pages plus 55 `/api/*` route handlers, one `Proxy (Middleware)` entry (see §4).
- A secondary nested layout exists for `/data-integrity/*` (`src/app/(app)/data-integrity/layout.tsx`) that renders its own tab strip and enforces a role gate (§5), and `/admin/roles/*` has its own gating layout (`src/app/(app)/admin/roles/layout.tsx`).

## 4. Authentication & authorization flow

- **Session mechanism**: custom JWT, not a third-party auth library. `src/lib/auth/session.ts` signs/verifies an HS256 JWT (`JWT_SECRET` env var) carrying `{ userId, email, role, fullName }`, stored in an httpOnly, `sameSite=strict` cookie named `wc_session` (`SESSION_COOKIE_NAME`), 24h expiry.
- **Login**: `POST /api/auth/login` (`src/app/api/auth/login/route.ts`) looks up `user_profiles` by email via Hasura (admin secret), does a constant-time `bcrypt.compare` (including a dummy-hash compare when the user doesn't exist, to resist email enumeration), and sets the cookie. `DELETE` clears it (sign-out, wired from the header profile menu in `layout.tsx:169-173`).
- **Route protection is centralized in `src/proxy.ts`** — this is Next.js 16's renamed `middleware.ts` (a `proxy()` export + `matcher` config, same shape as classic middleware). It redirects to `/login` when there's no valid session **and** the pathname starts with one of a hardcoded prefix list:
  ```
  APP_PATH_PREFIXES = ['/dashboard','/bills','/inventory','/movements','/transfers','/jobwork','/dispatch','/reports','/admin']
  ```
  (`src/proxy.ts:6-16`). Because this is a naive `startsWith` prefix match, `/jobwork-transfers`, `/jobwork-cancellations`, and `/jobwork-transfer-cancellations` are incidentally covered (they start with the substring `/jobwork`). **However `/accounts`, `/purchase-cancellations`, `/sale-cancellations`, and `/profile` are not in the prefix list at all**, and none of those four route trees has its own layout-level session guard (`src/app/(app)/accounts`, `.../purchase-cancellations`, `.../sale-cancellations`, `.../profile` — no `layout.tsx` in any of them). In practice these pages still fail to render usable data for an unauthenticated visitor because their Hasura queries run server-side regardless of session and the page will just show empty/zero state rather than actual protected data — but there is no redirect-to-login for these four route trees, unlike every other sidebar item. This is a real gap worth closing early in the redesign (e.g. broaden `APP_PATH_PREFIXES` or invert it to an explicit public-allowlist).
  - `/data-integrity` is *not* in `APP_PATH_PREFIXES` either, but it has its own guard in `src/app/(app)/data-integrity/layout.tsx:14-18` (redirects to `/dashboard` if not signed in or role not in `CAN_VIEW`), so it's fine.
- **OAuth**: Google OAuth exists (`src/app/api/auth/google/route.ts`, `.../google/callback/route.ts`, `.../google/debug/route.ts`) as an alternate sign-in path alongside password login.
- **Password flows**: `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/change-password` (nodemailer-based reset email).
- **First-run setup**: `/setup` + `/api/auth/setup` (and `/api/auth/setup/restore`) — bootstraps the first admin user / restores from a backup, guarding against re-running once a user exists (not fully traced, out of scope for this pass).
- **Authorization model**: Hasura is always called with the full **admin secret** from server-side code (`src/lib/hasura/transport.ts:20-28`, `src/lib/hasura/server.ts:37-46`) — there is no per-user Hasura role/permission layer, no Postgres RLS enforcement path from the app's perspective. All authorization is therefore application-layer only, and it is **inconsistently applied**: only **8 files** in the whole `(app)` tree do an explicit `session.role` / `CAN_VIEW` / `ALLOWED_ROLES` check (`data-integrity/*` — 5 files, `admin/roles/layout.tsx`, `reports/item-ledger/page.tsx`, `jobwork-transfers/page.tsx`). Every other screen (Purchase Entry, Sale Entry, Transfers, Job Work, Accounts, all of Admin except Roles, all other Reports, etc.) only requires "is logged in" — any authenticated role can read and write there today. This is the single biggest authorization finding for the redesign to address if the new spec implies per-role screen restrictions beyond simple login-gating.
- **`/api/graphql`**: a client-exposed GraphQL proxy (used by `hasuraFetch()` for client components like `useDashboardData`) — `src/proxy.ts:47-50` requires a session for this endpoint but does not filter/scope the query by role; it forwards to Hasura with the same admin secret server-side.

## 5. Roles & permissions

- **Base roles** (`user_profiles.role`, `CHECK` constraint, migration `001_initial_schema.sql:114` + `021_add_developer_role.sql`): `admin`, `company_manager`, `warehouse_manager`, `sales_manager`, `billing_staff`, plus `developer` (added later).
- **Custom roles overlay**: `custom_roles` + `role_permissions` tables (migration `017_roles_permissions.sql`) power `/admin/roles` and `/admin/roles/new`, giving per-screen `can_read`/`can_write` flags against the screen list in `src/lib/screens.ts` (3 groups: Main, Reports, Administration — note this screen catalogue is a *different, older* list than the live 16-item sidebar in `layout.tsx`, and does not include Data Integrity, Purchase Cancellations, Job Work Transfers/Cancellations, or Sale Cancellations — it looks stale relative to the current nav and should be reconciled during the redesign work).
- **Where checks actually run**: scattered `Set<string>` role-gate constants per module rather than one central policy table — e.g. `src/lib/dataIntegrity/auth.ts` (`CAN_VIEW`, `CAN_RUN_SCAN`, `CAN_MANAGE_RULES`, `CAN_PROPOSE_REPAIR`, `CAN_APPROVE_REPAIR`), `src/lib/purchaseImport/auth.ts` (`ALLOWED_ROLES`), and one-off `ALLOWED_ROLES` set inline in `admin/roles/layout.tsx`. There is no single `src/lib/permissions.ts` — a redesign that wants consistent RBAC should probably consolidate these.
- The `custom_roles`/`role_permissions` mechanism from §5 above and the hardcoded role-name gates from §4/§5 are two parallel, not obviously reconciled systems — worth flagging to the human reviewer.

## 6. Hasura/GraphQL integration summary

- Client setup lives in `src/lib/hasura/`:
  - `server.ts` — server-side `hasuraQuery`/`hasuraMutation`/`hasuraRunSql` (the latter runs raw SQL via Hasura's `/v2/query` `run_sql` endpoint with the admin secret — used for procedural repair/reconciliation work).
  - `transport.ts` — the shared `hasuraFetchEnvelope()` used by both server and (via the `/api/graphql` proxy) client code; branches on `LOCAL_MODE` to instead call the embedded-Postgres executor (`src/lib/localdb/executor.ts`) for the desktop build.
  - `fetcher.ts` (client-side `hasuraFetch()`, used by e.g. `useDashboardData.ts`) and `client.ts` (an explicit dead stub — `initializeApollo`/`useApollo` return `null`; comment says "not used. All Hasura access goes through fetcher.ts and server.ts" — this file is leftover and could be deleted in the redesign cleanup pass).
  - `queries.ts` — **2,130 lines** of hand-written GraphQL template-literal strings (no codegen, no `.graphql` files, no `graphql-codegen` in `package.json`). Types are hand-maintained TS interfaces alongside, not generated from the schema — a real drift risk and a candidate for introducing codegen during the redesign.
- **No Hasura metadata directory is checked into the repo** (no `hasura/metadata/*.yaml`). There's only `scripts/hasura-reload-metadata.mjs`, implying metadata is managed live against a running Hasura instance (console or scripted) rather than version-controlled — worth flagging as a deployment/reproducibility risk independent of the redesign.
- 55 files under `src/app/api/*/route.ts` — the Next.js API layer that fronts most mutations/side-effecting operations (cancel/purge/submit/delete/backup/restore/import), rather than calling Hasura mutations directly from client components in most cases.

## 7. Database entities & migrations summary

- `supabase/migrations/` contains **95 tracked `.sql` files** at last count (numbered `001`–`093`, plus several out-of-sequence renumbered/inserted repair migrations visible in git status at the time of this audit: `071`, `078`–`083`, all uncommitted). The numbering has multiple "fix the previous fix" migrations (e.g. `078` → `079` → `080` "fix 078's transfer-out date" → `082` "redo" → `083` "fix 082's transfer-out date"), and a distinct, generically-named-but-actually-hand-patched incident file `084_repair_cr00700_duplicate_cancel.sql` — same shape of manual, per-incident SQL repair as the earlier `062`/`063` history noted in project memory. This recurring pattern (real double-post incidents fixed by bespoke numbered migrations after the fact) is exactly what motivated Data Integrity rule `REC-001` (§8) and is good evidence the redesign's data-integrity ambitions are well-targeted.
- Notable schema areas: `user_profiles`/`custom_roles`/`role_permissions` (auth), `purchase_import_batches`/`purchase_import_rows` (import staging, migration `092`), `reconciliation_rules`/reconciliation run & exception tables (data integrity, migrations `085`–`091`), plus the core transactional tables (`purchase_bills`, `dispatch_orders`, `job_work_orders`, `transfers`, `stock_ledger`, etc.) not enumerated exhaustively here.
- `LOCAL_MODE` desktop build runs the same migrations against an embedded Postgres (`embedded-postgres` package) rather than Supabase-hosted Postgres.

## 8. Existing Classic/Modern/"existing"-view theme implementation — THE KEY QUESTION

**Short answer: it's a mixed picture, and the split is *not* uniformly shell-only.**

- The **app shell** (sidebar background/nav-item styling, header styling, mobile bottom-nav styling) genuinely is shell-only, exactly as the code comment claims. Evidence:
  - `src/app/(app)/layout.tsx:14-60` — the `CHROME` const, keyed by `DashboardView = 'existing' | 'classic' | 'modern'`, contains *only* Tailwind class strings (`sidebarBg`, `navItemBase`, `navItemActive`, `navItemInactive`, `headerClass`, `mobileNavBg`, `mobileNavActive`, `mobileNavInactive`) — no per-view component swap.
  - `src/app/(app)/layout.tsx:151-381` (`AppLayoutShell`) renders one single sidebar/header/mobile-nav JSX tree, applying `chrome.*` classes conditionally (`className={cn(chrome.navItemBase, isActive ? chrome.navItemActive : chrome.navItemInactive)}`, line 251) — the same `navItems` array (lines 68-149, same 16 items, hrefs, labels, emoji icons), the same `isActive` logic, for all three views. This part of the claim ("same links, hrefs, labels, icons and active-route logic everywhere; only these class strings change" — comment at `layout.tsx:14-15`) is **accurate**.
  - The three-way view state itself lives in `src/components/DashboardViewProvider.tsx` (React context + `useState<DashboardView>`, defaulting to `'existing'` on first paint to avoid hydration mismatch, then hydrating from `localStorage` — key `warecore.dashboard.view.v1` in `src/lib/dashboardViewPreference.ts`) and is toggled via `src/components/DashboardViewToggle.tsx` (a 3-button `<div role="group">`, options `Existing`/`Classic`/`Modern`, `src/components/DashboardViewToggle.tsx:7-11`). This provider wraps the *entire* `(app)` layout (`layout.tsx:151-157`), so the choice is global and persists across all 86 routes' chrome.

- **But the `/dashboard` page body itself is genuinely tripled, not shared.** Evidence:
  - `src/app/(app)/dashboard/DashboardViewSwitcher.tsx:32-38` — `if (view === 'classic') return <ClassicDashboard />`, `if (view === 'modern') return <ModernDashboard />`, else render the server-fetched `existingView` prop.
  - `src/app/(app)/dashboard/page.tsx` (Server Component, 226 lines) contains the full "existing" dashboard body inline (stat cards, stock-by-company, quick actions, recent movements table) built from a server-side `getDashboardStats()` call (`hasuraQuery`) and a separate `RecentMovements()` server component.
  - `src/app/(app)/dashboard/ClassicDashboard.tsx` (162 lines) and `src/app/(app)/dashboard/ModernDashboard.tsx` (188 lines) are **complete, independent client-component reimplementations** of the same dashboard content (compact-strip layout for Classic, presumably card/gradient layout for Modern — not fully read line-by-line but confirmed structurally parallel), each driven by `src/app/(app)/dashboard/useDashboardData.ts` — a **separate client-side data-fetching hook** that re-issues the *same two* GraphQL queries (`DASHBOARD_STATS_QUERY`, `RECENT_MOVEMENTS_QUERY`) via `hasuraFetch()` (the browser-safe proxy through `/api/graphql`) instead of reusing the server-rendered data. The code comment at `useDashboardData.ts:41-45` is explicit about this being an intentional (if duplicative) design: "Client-side counterpart to the server-fetched Existing dashboard's `getDashboardStats()`... Classic and Modern show real data computed the same way — only fetched lazily, on mount, instead of during the server render."
  - This tripling (`DashboardViewSwitcher`/`ClassicDashboard`/`ModernDashboard`) is **scoped to `/dashboard` only** — a repo-wide search for `Classic`/`Modern` component names (`grep -r "Classic|Modern" src/app`) returns matches *only* inside `src/app/(app)/dashboard/*`. No other route has a `ClassicXxx`/`ModernXxx` pair.

- **Net implication for "consolidate to exactly two visual modes"**: the shell-level three-way split (existing/classic/modern chrome classes, `DashboardViewProvider`/`DashboardViewToggle`/`dashboardViewPreference.ts`) is cheap to collapse to two — it's a data/typing change (`DashboardView = 'classic' | 'modern'`, drop the `existing` chrome entry and its toggle option, pick a migration default for existing users' `localStorage` value) plus deleting whichever full chrome style loses. But `/dashboard` specifically carries **three real, independently-coded, independently-data-fetched implementations** that must be explicitly reconciled — deleting "existing" here means deciding whether `ClassicDashboard`/`ModernDashboard` become the sole two dashboard bodies (in which case the still-unused `page.tsx` inline "existing" JSX + its server-fetched `getDashboardStats()`/`RecentMovements()` should be removed and something needs to decide whether the final two dashboards move back to server-rendering, since right now *only* the soon-to-be-deleted "existing" view is server-rendered — Classic/Modern both do a client-side fetch-on-mount with a loading skeleton, which is a real perf/UX regression vs. "existing" that the redesign should either accept knowingly or fix as part of collapsing to two modes). **Every other route (85 of 86) needs no page-body work for the two-mode consolidation** — only the shared shell class strings.

## 9. Reports & exports inventory

- `/reports` is a landing/index page (`REPORTS_QUERY`) linking to 10 report screens: Billing, Daywise Stock Statement, Dispatch, Item Ledger, Job Work, Movements, Purchase Line Ledger, Stock Reconcile, Stock Statement, Transfers, Vendor Movements (11 counting the index itself — see matrix for exact routes).
- Excel export is implemented via `exceljs` in three shared helpers: `src/lib/exportExcel.ts`, `src/lib/exportProfessionalExcel.ts`, `src/lib/exportStockStatementExcel.ts`, invoked from per-page `ExportButton`/`ExportExcelButton`/`StockStatementExportButton`/`ProfessionalExportButton` components. Export buttons appear on essentially every Reports page plus several list screens (Inventory, Movements, Purchase Cancellations, Job Work Cancellations, Job Work Transfer Cancellations, Sale Cancellations).
- **No chart/graph library exists anywhere in the codebase** — confirmed by `package.json` (no `recharts`/`chart.js`/`d3`/`victory`/`nivo`/`visx`) and no in-repo usage. All "visualizations" today are HTML tables and static stat-card tiles. The redesign's "responsive charts" requirement is a net-new capability, not a wire-up of an existing library.

## 10. Icons/images/logos/favicons/fonts/chart libraries inventory

- **Icons**: `lucide-react` 1.16.0 is a dependency, used in only **8 files** (`src/components/ai/CopilotButton.tsx`, `CopilotPanel.tsx`, `ChatMessage.tsx`, `ConversationList.tsx`, `ChatInput.tsx`, plus `src/components/ExportExcelButton.tsx`, `src/components/ProfessionalExportButton.tsx`, `src/app/(app)/reports/stock-statement/StockStatementExportButton.tsx`). Everywhere else — the entire sidebar (`layout.tsx`), every list/detail page's action buttons, stat cards, all report pages — icons are raw emoji characters embedded directly in JSX/TS string literals. A broad Unicode-range grep found **268 emoji occurrences across 100 of the ~278 `.ts`/`.tsx` files** in `src/` (this count sweeps a wide emoji/symbol/arrow Unicode range and may include a handful of false positives from comments, but the order of magnitude — emoji used in over a third of all source files vs. a real icon library used in 8 — is solid). This fully confirms the audit context and quantifies the icon-system-replacement scope: it's not a handful of stray emoji, it's the app's primary icon strategy today.
- **Images/logos**: `public/` has only 15 files. Five are unmodified Next.js starter-template defaults (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) that appear unused/vestigial and are candidates for deletion. The real branded assets are the PWA icon set (`public/icons/icon-{72,96,128,144,152,192,384,512}x{...}.png`) and `public/manifest.json` (name "WareCore", theme colour `#2563eb`, background `#111827`) — no SVG source/logo file was found, only the rasterized PWA sizes, so a scalable brand-mark source doesn't currently exist in-repo. `src/app/favicon.ico` exists (Next.js App Router convention).
- **Fonts**: not separately audited in depth; no `next/font` custom font imports were surfaced during this pass (worth a follow-up grep before Phase 1 typography work).
- **Charts**: none, see §9.

## 11. Known broken navigation / duplicated transaction screens / empty handlers / TODOs / mock data / dead code

- **No `href="#"` and no literally-empty `onClick={() => {}}` handlers were found anywhere in `src/app`** — a targeted grep for both patterns returned zero matches, so there's no obviously "dead" nav link or no-op button of that shape.
- **TODO/FIXME/mock-data markers**: only 3 files matched (`src/lib/dataIntegrity/engine.ts`, `src/lib/dataIntegrity/rules.ts`, `src/app/page.tsx`) — the codebase is largely free of leftover TODO comments, which is good hygiene but also means any genuinely-unfinished behaviour isn't self-flagged in-code; treat the Data Integrity Phase 1 gaps (§ below) and the purchase-import gaps as the real "not done yet" list rather than trusting a TODO grep.
- **Auth gap**: see §4 — `/accounts`, `/purchase-cancellations`, `/sale-cancellations`, `/profile` are not covered by the `proxy.ts` redirect-to-login gate that every other sidebar route gets. Not "broken" in the sense of a 404/crash, but an inconsistency worth fixing.
- **Stale screen catalogue**: `src/lib/screens.ts` (used for the custom-roles permission matrix) lists a Main/Reports/Administration screen set that doesn't include Data Integrity, Purchase Cancellations, Job Work Transfers, Job Work Cancellations, or Sale Cancellations — i.e. 5 of the 16 live sidebar items have no corresponding row in the custom-role permission UI at `/admin/roles/new`, so a custom role literally cannot be granted or denied access to those five screens today. This should be reconciled as part of any RBAC work in the redesign.
- **Dead/stub file**: `src/lib/hasura/client.ts` is an explicit no-op stub (`initializeApollo`/`useApollo` both return `null`, comment says "not used") — safe to delete.
- **Duplicated dashboard logic**: see §8 — `Existing`/`Classic`/`Modern` dashboards independently fetch and independently render the same two queries' worth of data; this is the one clear case of duplicated-screen logic found in this pass. No other duplicated transaction screens (e.g. two different components serving the same route) were found.
- **Migration "fix-the-fix" pattern**: see §7 — a real, recurring incident pattern of manual SQL repair migrations for duplicate-posting bugs (`062`/`063`, `078`–`083`, `084`), which is direct evidence for why the Data Integrity module's `REC-001` "exact duplicate ledger event" rule exists and matters for the redesign's reconciliation ambitions.

### Data Integrity module coverage vs. the requested rule list

`src/lib/dataIntegrity/rules.ts` implements **10 of an already-catalogued 18 rules** (`supabase/migrations/086_data_integrity_seed_rules.sql` seeds the full 18-rule catalogue with descriptions, severities, and an explicit `is_enabled` flag per rule):

| Implemented (10) | Not yet implemented (8) |
|---|---|
| REC-001 Exact duplicate ledger event | REC-004 Source-to-ledger quantity mismatch |
| REC-002 Missing ledger posting | REC-006 Invalid movement sign |
| REC-003 Orphan ledger entry | REC-010 Company/warehouse mismatch |
| REC-005 Negative warehouse stock | REC-011 Effective-date mismatch |
| REC-007 Reversal mismatch | REC-012 Backdated/late posting |
| REC-008 Transfer pair mismatch | REC-015 Source header/detail mismatch |
| REC-009 Job Work equation mismatch | REC-016 Duplicate source business identifier |
| REC-013 Zero-stock validation | REC-017 Trigger-chain duplicate risk |
| REC-014 Report equation mismatch | |
| REC-018 Unbalanced vendor-held stock | |

**Directly answering the audit's specific question**: yes — **REC-001 already generically covers "duplicate PURCHASE_CANCEL/ledger row inserted twice in seconds for the same line."** Its seed description (migration `086`, line for `REC-001`) says verbatim: *"Detects repeated stock_ledger rows representing the same business event (same entry type, source document/line, item, company, warehouse, quantity, created close together in time)... This is the rule class that would have caught CR00700's duplicate PURCHASE_CANCEL."* So the exact incident class that previously required a one-off manual migration (`084_repair_cr00700_duplicate_cancel.sql`, and the earlier `062`/`063` `JOB_WORK_RETURN_IN` double-post) now has a standing, enabled detection rule — a genuine Phase-1 win, not a gap. The requested rule list's remaining items map roughly onto the 8 not-yet-implemented rules above (header/line-total mismatch → REC-015, negative/impossible quantities → covered partly by REC-005/REC-006, date/reference anomalies → REC-011/REC-012, duplicate doc numbers → REC-016, sequence/audit gaps → closest is REC-017). Repair *execution* (auto-fixing a detected exception) exists only as a disabled pilot (`supports_auto_repair` is `FALSE` for every seeded rule; `reconciliation_settings.repair_execution_enabled` is `FALSE`) — detection is ahead of remediation by design.

### Purchase import workflow vs. the requested spec

`purchase_import_batches`/`purchase_import_rows` (migration `092_purchase_import_batches.sql`) implements:
- ✅ Persistent staging (rows kept in DB, not an ephemeral upload-preview-commit flow)
- ✅ Per-row/per-column correction with an append-only `correction_history` audit trail
- ✅ Revalidation on correction (`is_valid`/`validation_errors` recomputed by app code, not persisted-then-stale)
- ✅ Idempotency signal at the **file** level (`file_hash` + `duplicate_of_batch_id` — warns on re-upload of the same bytes)
- ✅ All-or-nothing posting (explicit product decision, documented in the migration's own comment block, lines 14-23)
- ⚠️ **Row status model is binary, not the requested 7-state enum.** The schema only has `is_valid BOOLEAN` + `reviewed BOOLEAN` (two independent booleans) — there is no `Warning` (non-blocking issue) distinct from `Error` (blocking), no explicit `Ready`/`Skipped` row states, and no per-row `Imported` flag (the whole batch flips `STAGED → IMPORTED` atomically). The batch-level status enum is deliberately minimal: `STAGED | IMPORTED | CANCELLED` (migration `092`, line 35) — no `PROCESSING`/`PARTIALLY_IMPORTED`/persisted `FAILED`, by explicit design (comment lines 14-23).
- ❌ **No downloadable result file was found.** A grep for download/export logic under `src/app/(app)/bills/import` only turns up the *template* download (for the initial upload), not a post-import results/audit file.
- **Net**: the workflow is materially more complete than a one-shot importer and covers the hard parts (idempotent, auditable, revalidating, all-or-nothing), but the row-status vocabulary and the downloadable-result-file requirement from the new spec are both gaps against what's built today.

## 12. Existing tests inventory

- **13 test files**, all under `tests/data-integrity/*` (5 files: `dispatch-lifecycle`, `engine`, `purchase-lifecycle`, `repair-execution`, `rules`) and `tests/purchaseImport/*` (8 files: `batches`, `buildTemplateWorkbook`, `commit`, `correction`, `db`, `finalImport`, `parseWorkbook`, `resolve`). **Zero test files exist for any route/page component** — the entire 86-route UI surface (including all 82 originally-scoped routes) has no test coverage at the component/route level today; only two library modules (data integrity, purchase import) have any tests at all, and (see §13) those currently don't even run.

## 13. Current lint/typecheck/test/build results

All four commands were run via `npm run <script>` against the working tree as-is; nothing was changed to fix failures.

### `npm run lint` — **FAIL (exit 2, crashes before producing any lint results)**
```
> warecore@1.1.5 lint
> eslint

Oops! Something went wrong! :(

ESLint: 10.4.0

TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
Occurred while linting c:\Users\Public\Projects\warecore\capacitor.config.ts
    at resolveBasedir (...\node_modules\eslint-plugin-react\lib\util\version.js:31:100)
    at detectReactVersion (...\node_modules\eslint-plugin-react\lib\util\version.js:85:19)
    ...
```
Root cause looks like an `eslint-plugin-react` incompatibility with ESLint 10.4.0's new rule-context API, tripped specifically while linting `capacitor.config.ts` (a non-React file — the React-version-detection rule logic is running somewhere it shouldn't, or the plugin hasn't been updated for ESLint 10's flat-config `context` object shape). This means **lint currently provides zero signal** on the rest of the codebase — every file is unlinted until this is fixed. High priority to fix before the redesign starts touching dozens of files, or lint will never catch anything.

### `npm run typecheck` — **PASS (exit 0)**
```
> warecore@1.1.5 typecheck
> tsc --noEmit
```
No output, clean exit. TypeScript compiles cleanly across the whole project today — a solid baseline for the redesign to preserve.

### `npm run test` — **FAIL (exit 1, 13/13 suites fail to collect; 0 tests actually run)**
```
 RUN  v4.1.10 c:/Users/Public/Projects/warecore
...
⎯⎯⎯⎯⎯⎯ Failed Suites 13 ⎯⎯⎯⎯⎯⎯

 FAIL  tests/data-integrity/dispatch-lifecycle.test.ts [ tests/data-integrity/dispatch-lifecycle.test.ts ]
Error: Vitest failed to find the current suite. One of the following is possible:
- "vitest" is imported directly without running "vitest" command
- "vitest" is imported inside "globalSetup" (to fix this, use "setupFiles" instead...)
- "vitest" is imported inside Vite / Vitest config file
- Otherwise, it might be a Vitest bug.
...
 FAIL  tests/purchaseImport/buildTemplateWorkbook.test.ts [ ... ]
TypeError: Cannot read properties of undefined (reading 'config')
...
 Test Files  13 failed (13)
      Tests  no tests
```
9 of the 13 suites fail with "Vitest failed to find the current suite"; the other 4 (`buildTemplateWorkbook`, `db`, `parseWorkbook`, `resolve`, all in `purchaseImport`) fail with `Cannot read properties of undefined (reading 'config')`. Combined with the pre-run warning (`Your Vite config uses features that are unsupported by 'configLoader: native'... ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)`), this strongly suggests a **Vitest/Vite config-loading mismatch** — likely `vitest.config.ts` needs to be `.mts`/ESM-flagged, or the installed Vitest 4.1.10 is newer than what the config file was written against. **All 13 existing tests currently provide zero signal**; this needs to be fixed before the redesign can rely on the data-integrity/purchase-import test suites as a safety net.

### `npm run build` — **PASS (exit 0)**
```
▲ Next.js 16.2.6 (Turbopack)
- Environments: .env.local
  Creating an optimized production build ...
✓ Compiled successfully in 72s
  Running TypeScript ...
  Finished TypeScript in 38.9s ...
  Generating static pages using 7 workers (68/68) in 2.6s
  Finalizing page optimization ...

Route (app)
[... full route table, 68 app routes + 55 api routes, one ƒ Proxy (Middleware) entry ...]
```
Production build succeeds cleanly, static/dynamic route split looks sane (most transactional pages are `ƒ` dynamic as expected; list/landing pages are `○` static where they can be). This is a healthy baseline going into the redesign.

**Summary**: typecheck and build are clean; lint and test are both currently broken at the tooling level (not from code defects visible in this pass) and should be fixed early so the redesign work has real CI signal rather than silently unlinted/untested changes landing throughout a large multi-phase effort.
