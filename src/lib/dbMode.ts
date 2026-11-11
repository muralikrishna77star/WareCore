/**
 * Whether the app talks to Postgres directly (src/lib/localdb) instead of
 * through Hasura Cloud.
 *
 * - LOCAL_MODE=true  — the desktop build (embedded Postgres). Also switches on
 *   desktop-only behaviour elsewhere (local Google client, request-origin URLs).
 * - DIRECT_DB=true   — the web deployment talking straight to Neon. Data access
 *   only; none of the desktop behaviour. Added 2026-11-11 when the Hasura Cloud
 *   project disappeared and Hasura no longer offered a free v2 plan.
 *
 * Both need DATABASE_URL.
 */
export const DIRECT_DB = process.env.LOCAL_MODE === 'true' || process.env.DIRECT_DB === 'true'
