# WareCore — Claude Code Master Implementation Prompt

Copy this entire prompt into Claude Code in VS Code from the root of the existing WareCore repository.

---

## ROLE AND OBJECTIVE

Act as a senior product architect, UX engineer, Next.js/TypeScript developer, database-aware integration engineer, and QA lead. Redesign and complete the existing **WareCore** warehouse management application as a stable, production-ready system.

## AUTHORITATIVE VISUAL REFERENCE

Use the currently published WareCore visual application as the authoritative appearance reference:

`https://warecore-app.muralikrishna77star.chatgpt.site/`

Inspect this public URL before changing UI code. Reproduce and preserve its recognizable visual language in the real WareCore repository, including:

- WareCore logo, compact brand mark, wordmark proportions, placement, and colour treatment;
- the exact icon choices and their meaning in sidebar items, buttons, cards, alerts, filters, tables, and actions;
- sidebar structure, header, user/profile placement, cards, tables, forms, tabs, badges, charts, dialogs, spacing, borders, corner radii, shadows, and colour hierarchy;
- desktop, tablet, and mobile responsive behaviour;
- Classic and Modern presentation patterns shown by the reference.

Do not redesign the product into an unrelated generic dashboard. Do not replace the WareCore logo or the reference icons with arbitrary alternatives merely for convenience. Where the reference uses assets that are not already in the repository, recreate or obtain repository-safe equivalents, save them locally under `public/assets`, and document them in the asset manifest. Do not hotlink the public reference site at runtime.

Treat the public URL as a **visual reference only**. Do not copy mock data, credentials, endpoints, storage configuration, or demonstration-only business behaviour into production. The existing WareCore repository remains authoritative for real data, routes, permissions, integrations, and calculations.

Do not build a disconnected demo. Work inside the existing repository, inspect it first, preserve working business logic, and connect every screen to the real application architecture.

The finished application must support exactly two visual modes:

1. **Classic** — compact, data-dense, keyboard-friendly screens suitable for experienced warehouse and accounts users.
2. **Modern** — polished, responsive enterprise SaaS screens with clearer hierarchy, cards, charts, drawers, and guided workflows.

Remove or retire every other skin, theme preset, duplicated design experiment, or obsolete screen variant. Light/dark colour preference may exist within a mode only if the current application already supports it cleanly; it must not become a third mode.

## NON-NEGOTIABLE SAFETY RULES

- Preserve the existing database schema, Hasura metadata, GraphQL operations, authentication, authorization, role permissions, APIs, calculations, audit history, and business workflows unless a change is demonstrably required.
- Never replace real data with mock data.
- Never silently delete routes, features, fields, filters, actions, validations, reports, or permissions.
- Never guess database column names or GraphQL fields. Inspect generated types, metadata, migrations, queries, and existing code.
- Never run destructive database operations.
- Do not apply migrations to production automatically.
- Do not expose secrets in source code, browser bundles, logs, screenshots, or documentation.
- Prevent duplicate submissions for all financial and stock-changing transactions.
- Use decimal-safe quantity and monetary calculations; do not rely on floating-point arithmetic for persisted values.
- Maintain a complete audit trail for every create, update, cancel, approve, import, reconciliation, and correction action.

## PHASE 0 — REPOSITORY AUDIT BEFORE CODING

Inspect the full repository and produce `docs/WARECORE_REDESIGN_AUDIT.md` containing:

- detected framework and versions;
- package manager and commands;
- application routes and layouts;
- authentication and authorization flow;
- roles and permissions;
- Hasura/GraphQL clients, operations, generated types, metadata, and migrations;
- database entities and transaction relationships;
- all current screens and whether each is complete, duplicated, broken, or missing;
- existing Classic/Modern/theme implementation;
- reports and exports;
- existing icons, images, logos, favicons, fonts, and chart libraries;
- known broken navigation, duplicated transaction screens, empty handlers, TODOs, mock data, and dead code;
- existing tests and current test/build/type-check results.

Create `docs/ROUTE_AND_FEATURE_MATRIX.md` with one row per route and these columns:

`Module | Menu item | Route | Current component | Required data | Actions | Permissions | Classic status | Modern status | Test status`

Do not begin broad visual rewriting until this audit identifies the actual components and dependencies.

## INFORMATION ARCHITECTURE

Preserve the existing 16-item sidebar order discovered in the repository/specification. The known leading order is:

1. Dashboard
2. Admin
3. Backup & Restore
4. Data Integrity
5. Purchase Entry
6. Purchase Cancellations
7. Accounts
8. Inventory

Continue the remaining items in their exact existing order after inspecting the current application. Do not invent or reorder them. Submenus must expand/collapse reliably and every leaf must navigate to its unique route and screen.

Required public/application coverage includes the existing public routes, authentication, password reset, first-run setup, offline fallback, app shell, operational modules, masters, reports, administration, settings, and AI Copilot where present.

Fix these known navigation failures:

- submenu options must open when clicked;
- links must resolve to the correct route;
- Purchase Entry and Purchase Cancellations must expose their intended child options;
- New Purchase, New Dispatch, transfer, job-work, return, cancellation, and other transaction entries must not reuse the same generic screen unless a shared engine renders the correct transaction-specific fields, rules, labels, and handlers;
- active menu state, breadcrumbs, browser back/forward, deep links, refresh, and permission-based visibility must work;
- mobile navigation must close after selection and remain keyboard accessible.

## APP SHELL

Build one shared shell used by both modes:

- collapsible left sidebar;
- top header with company/warehouse context;
- global search or command palette;
- notifications;
- breadcrumbs;
- help entry;
- online/offline status;
- user ID/name and profile menu at the **top-right**;
- mode switch containing only `Classic` and `Modern`;
- sign-out action;
- responsive desktop/tablet/mobile behavior.

Persist the chosen mode per user where the current settings architecture permits it, with a safe local fallback. Switching modes must not lose filters, drafts, route, selection, or transaction context.

## DESIGN SYSTEM

Create shared design tokens rather than two independent applications.

### Typography enlargement — required amendment

Increase text size **slightly** compared with the published visual reference while preserving its overall appearance and information density. Implement this through central typography/design tokens, not browser zoom, CSS `transform: scale`, or scattered one-off overrides.

Use the existing computed sizes as the baseline and generally apply the following controlled increase:

- primary body text: increase by approximately `1px` (target about `16px` where the reference is about `15px`);
- sidebar/menu text: increase by approximately `1px` (target about `15px` where the reference is about `14px`);
- form labels, helper text, badges, and compact metadata: increase by approximately `1px`, while keeping a practical minimum of `13px` for non-decorative text;
- table headers and table cells: increase by approximately `1px` (normally target `14px` or above) without losing column readability;
- buttons, inputs, selects, tabs, breadcrumbs, and pagination: increase by approximately `1px` and adjust control height/line-height only as needed;
- page titles and section headings: increase proportionally by `1–2px`, preserving the existing hierarchy rather than making headings oversized.

Keep the same font family and weights seen in the reference unless the existing WareCore repository already defines the authoritative brand font. Use readable line-height, normally about `1.45–1.6` for body copy and a tighter proportional line-height for headings and compact controls.

After enlarging text, adjust only the minimum necessary padding, row height, sidebar width, card height, and responsive breakpoints. The change must not cause:

- clipped labels or icons;
- overlapping text;
- broken badges or buttons;
- accidental two-line sidebar labels;
- excessive table row height;
- hidden filters or actions;
- horizontal page overflow;
- truncated user ID/profile text;
- broken mobile navigation.

Validate typography at common widths around `1440px`, `1280px`, `1024px`, `768px`, and `390px`. Compare screenshots against the public reference and confirm that the application still looks like the same WareCore design, only more readable.

### Modern mode

- premium enterprise SaaS appearance;
- clear whitespace and visual hierarchy;
- navy/indigo primary palette with accessible semantic colours;
- medium rounded corners and restrained shadows;
- KPI cards, responsive charts, drawers/modals, empty states, skeletons, and clear guidance;
- responsive tables that preserve critical fields on small screens.

### Classic mode

- compact toolbar and forms;
- high information density;
- visible borders and clear column alignment;
- minimal decorative spacing;
- fast keyboard navigation and shortcuts;
- sticky table headers, column filters, totals, and saved layouts;
- familiar desktop-style interaction without copying obsolete browser styling.

### Shared accessibility

- WCAG AA colour contrast;
- visible focus state;
- semantic labels and landmarks;
- complete keyboard operation;
- accessible dialogs and menus;
- no meaning communicated by colour alone;
- support reduced motion.

## LOCAL ICON AND IMAGE ASSET REQUIREMENT

Claude Code must leave every required visual asset available inside the repository. Nothing essential may depend on this chat, a temporary URL, a design screenshot, a private artifact URL, or a developer's machine.

1. Use the repository's existing icon system when consistent. Otherwise standardize on one tree-shakeable package such as `lucide-react`; do not mix multiple icon families.
2. Import icons by name through typed React components. Do not use emoji or Unicode symbols as production UI icons.
3. Store WareCore-owned visuals under:

```text
public/assets/
  brand/
  illustrations/
  empty-states/
  auth/
  reports/
  icons/
```

4. Prefer SVG for logos, line illustrations, and scalable UI art; WebP/AVIF for raster imagery; PNG only when transparency or compatibility requires it.
5. Preserve or recreate the WareCore logo as local source-controlled files, including full logo, compact mark, light/dark-safe variants, favicon, and app icons where applicable.
6. Create `public/assets/ASSET_MANIFEST.md` with:

`File | Type | Purpose | Used by | Source/licence | Replacement notes`

7. Add descriptive `alt` text for meaningful images and empty alt text for decorative images.
8. Do not download copyrighted stock imagery without a compatible licence. Record attribution/licence when an external asset is legitimately used.
9. Remove unused duplicate assets only after proving they have no references.
10. Add a validation step that fails CI for missing local asset references or accidental remote hotlinks in core UI components.

Use icons consistently for navigation and actions, including dashboard, administration, backup/restore, data integrity, purchases, cancellations, accounts, inventory, dispatch, job work, transfers, reports, masters, settings, import, export, filters, search, notifications, approval, edit, delete/cancel, history, reconciliation, help, and AI Copilot.

## CORE SCREEN BEHAVIOUR

Every list/grid screen must support, where meaningful:

- global search;
- column-level filters matching the existing Classic screens;
- date range filters;
- company, warehouse, supplier/vendor/customer, item, status, and transaction-type filters as applicable;
- sorting, pagination, and page-size control;
- show/hide/reorder/resize columns;
- saved filter/view presets;
- clear-all filters;
- sticky headers and totals;
- loading, empty, error, permission-denied, and offline states;
- export using the currently applied filters;
- record details and audit/history access;
- stable URL query parameters for shareable filtered views where safe.

Preserve required legacy columns. Do not hide or remove operational fields simply to make Modern mode look cleaner; use responsive priority, drawers, or column controls.

## DASHBOARD

Implement a real-data dashboard with permission-aware widgets:

- stock at warehouse;
- stock at vendor/job worker;
- purchase, dispatch, transfer, and job-work activity;
- low-stock/exception alerts;
- pending approvals and imports;
- data-integrity exceptions;
- inventory movement trend;
- category/item distribution where supported by real data;
- recent movements;
- quick actions mapped to actual routes.

All KPI definitions must be documented and traceable to queries. Cards and charts must handle zero, null, loading, error, and restricted-access states.

## TRANSACTION WORKFLOWS

Build distinct, validated workflows for the transaction types present in WareCore, including purchase, dispatch/sale, purchase cancellation, transfer, job work out, job transfer, job return, and other repository-defined transactions.

For stock movement terminology:

- **Purchase:** Source = Supplier; Destination = purchasing company/warehouse.
- **Job Work Out:** Source = Company; Destination = Vendor.
- **Job Transfer:** Source = current Vendor; Destination = receiving Vendor.

Apply the repository's actual terminology and schema after inspection. Every posting workflow must include validation, review/confirmation, idempotency/double-submit protection, transaction-safe persistence, success receipt/reference, and auditable failure handling.

## PURCHASE IMPORT REVIEW AND CORRECTION

Complete an import staging workflow rather than directly posting imperfect files:

1. Upload and parse the supported file.
2. Store rows in a staging/import batch with source row number and raw values.
3. Validate schema, required fields, types, duplicates, totals, dates, company, supplier, items, quantities, rates, taxes, and references.
4. Match keys against the real database using deterministic rules.
5. Display batch summary and row statuses: `Valid`, `Warning`, `Error`, `Reviewed`, `Ready`, `Imported`, `Skipped`.
6. Let authorized users load the batch and review/correct individual records and individual columns.
7. Show source value, proposed corrected value, match candidates, validation message, and audit history.
8. Support filters for error type/status and safe bulk corrections where the same mapping applies.
9. Revalidate edited rows immediately.
10. Require review/confirmation before final import.
11. Import only ready rows using an idempotent, transactional process; never duplicate purchases on retry.
12. Produce a result summary and downloadable error/reconciliation file.
13. Retain who changed what and when.

## DATA INTEGRITY AND RECONCILIATION

Treat Data Integrity as a first-class operational module. Validate both existing historical data and future transactions.

Provide read-only scans for:

- duplicate ledger rows and double-submit signatures;
- orphan headers/lines/ledger records;
- header-line-total mismatches;
- purchase/cancellation imbalance;
- stock ledger versus calculated stock mismatch;
- negative or impossible quantities according to business rules;
- transaction date/reference anomalies;
- missing master references;
- duplicate document numbers within the relevant company/period;
- source/destination inconsistencies;
- records with unexpected zero/null values;
- sequence and audit gaps.

Each rule must display severity, company, item/document, expected value, actual value, difference, evidence, and recommended action. Scans must be non-destructive by default. Any repair must require explicit authorization, preview, backup/restore plan, audit log, and post-repair verification. Do not auto-fix production data.

Include the previously observed failure pattern: an identical `PURCHASE_CANCEL` being inserted twice within seconds for the same purchase line, followed by re-addition. Detect this pattern generically rather than hard-coding one item or document.

## REPORTS AND EXCEL EXPORTS

Preserve all report calculations and filters. Exclude rows where all relevant quantity/value measure columns are zero when the report specification requires this.

For each report other than the separately specified Stock Statement workbook, create a professional Excel export with:

- report title and generated metadata;
- company/warehouse and applied filters;
- freeze panes;
- styled headers;
- auto-filter;
- sensible widths and formats;
- dates as real Excel dates;
- quantities/rates/amounts as numeric cells;
- totals/subtotals using formulas where appropriate;
- no truncated values or `####` cells;
- optional detail sheet when the report has summary/detail data;
- safe sheet names and filenames;
- large dataset handling without freezing the browser;
- parity tests between on-screen filtered data and exported data.

Do not modify the Stock Statement export behaviour unless its dedicated specification is present in the repository.

## AI COPILOT

Preserve the existing Claude-backed AI Copilot, streaming responses, tool loop, item/ledger lookup tools, and persisted conversations where present. Integrate it visually into both modes without weakening security.

- Enforce user/company/warehouse permissions on every tool call.
- Never allow free-form model output to execute SQL or mutations directly.
- Keep provider abstraction and server-side secrets.
- Display citations/record links for factual stock answers where possible.
- Confirm before any state-changing action.
- Log tool activity safely without exposing secrets.
- Provide clear unavailable/error states when the AI provider is not configured.

## RESPONSIVE AND OFFLINE BEHAVIOUR

- Desktop: full sidebar, dense grids, multi-panel work.
- Tablet: collapsible navigation, touch-safe controls, preserved transaction usability.
- Mobile: drawer navigation, stacked forms, priority columns/cards, no horizontal page overflow except deliberate data-table scrolling.
- Offline fallback must communicate what is unavailable and must never imply that a stock-changing transaction succeeded when it has not reached the server.
- Do not queue financial/stock mutations offline unless the existing architecture has a proven conflict-safe synchronization design.

## ENGINEERING QUALITY

- Follow the repository's existing stack and conventions.
- Keep TypeScript strict; do not solve errors with broad `any`, ignored checks, or unsafe casts.
- Reuse typed components and hooks without hiding module-specific behaviour.
- Validate inputs on client and server.
- Use safe GraphQL variables and generated types where available.
- Add error boundaries and actionable error messages.
- Prevent N+1 queries and unbounded list retrieval.
- Use virtualization/server pagination for large grids.
- Keep accessibility and performance budgets visible.
- Avoid a full rewrite unless the audit proves it is necessary.

## TESTING REQUIREMENTS

Add or update tests for:

- every sidebar and submenu route;
- unique transaction screen rendering;
- Classic/Modern switching and persistence;
- permissions and route guards;
- filters, sorting, pagination, totals, and exports;
- purchase import validation, correction, revalidation, and idempotent posting;
- duplicate-submit prevention;
- stock calculations and reconciliation rules;
- local asset existence and absence of accidental hotlinks;
- responsive navigation;
- accessibility of primary flows;
- offline/error/empty/loading states;
- AI Copilot permission boundaries.

Run the repository's formatter, lint, type-check, unit tests, integration tests, end-to-end tests, and production build. Do not claim success if any command fails. Record pre-existing failures separately from newly introduced failures.

## IMPLEMENTATION SEQUENCE

Work in verifiable checkpoints:

1. Audit and route/feature matrix.
2. Shared design tokens and two-mode architecture.
3. Asset inventory and local icon/image foundation.
4. App shell, sidebar, header, breadcrumbs, profile placement, and navigation fixes.
5. Shared tables, filters, forms, dialogs, feedback states, and permissions.
6. Dashboard using real data.
7. Each transaction module, one at a time, with tests.
8. Purchase import staging/review/correction workflow.
9. Data Integrity and reconciliation module.
10. Reports and Excel exports.
11. AI Copilot integration in both modes.
12. Responsive/accessibility/performance hardening.
13. Full regression, documentation, and deployment readiness report.

After each checkpoint:

- list files changed;
- summarize behaviour completed;
- state commands run and exact results;
- identify remaining risks or blockers;
- commit only coherent, reviewable changes if git commits are authorized.

Do not pause after merely producing a plan. Continue implementing safe repository-local work. Stop and ask before production deployment, destructive database work, irreversible migrations, secret configuration, or any decision that materially changes business behaviour.

## REQUIRED DELIVERABLES

Deliver all of the following in the repository:

- working Classic and Modern modes only;
- corrected navigation and unique screens/workflows;
- local icons and image assets with manifest;
- completed route and feature coverage;
- real-data dashboard;
- purchase import review/correction flow;
- data integrity and reconciliation package;
- professional Excel exports except the separately controlled Stock Statement export;
- preserved and secured AI Copilot;
- automated tests;
- `docs/WARECORE_REDESIGN_AUDIT.md`;
- `docs/ROUTE_AND_FEATURE_MATRIX.md`;
- `docs/DESIGN_SYSTEM.md`;
- `docs/ASSET_GUIDE.md`;
- `docs/DATA_INTEGRITY_RULES.md`;
- `docs/TEST_REPORT.md`;
- `docs/DEPLOYMENT_AND_ROLLBACK.md`;
- `.env.example` containing names only, never secret values;
- final change summary and unresolved-risk register.

## DEFINITION OF DONE

The task is complete only when:

- there are exactly two selectable modes, Classic and Modern;
- the completed UI clearly matches the logo, icons, colours, layout language, and visual components of `https://warecore-app.muralikrishna77star.chatgpt.site/`;
- typography is slightly larger across navigation, body content, forms, controls, and tables through shared tokens, without clipping, unwanted wrapping, or loss of responsive usability;
- no obsolete skin is reachable or referenced;
- every menu/submenu navigates to the correct unique screen;
- user ID/profile is at the top-right;
- Classic screens retain required column filters and dense operation;
- Modern screens are responsive and polished without losing fields or functionality;
- all required icons/images are reproducible from repository dependencies or committed local assets;
- no essential visual depends on temporary or private URLs;
- all transaction writes are validated, permission-checked, auditable, and protected from duplicate submission;
- purchase imports can be staged, reviewed, corrected by row/column, revalidated, and safely posted;
- existing data can be scanned for integrity defects without destructive changes;
- exports match filtered report data;
- real integrations and real data are preserved;
- lint, type-check, tests, and production build pass, or any genuine external blocker is documented with evidence;
- documentation enables another developer to maintain and deploy the result.

## FIRST RESPONSE FORMAT

Begin by reporting:

1. detected stack and package manager;
2. current route/menu count;
3. detected skins/themes and where they are implemented;
4. icon/image inventory summary;
5. broken or duplicated screens found;
6. database/Hasura integration summary;
7. current test/build status;
8. the first safe implementation checkpoint you will execute.

Then proceed with the audit and implementation.
