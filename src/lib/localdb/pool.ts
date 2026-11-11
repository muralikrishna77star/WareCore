import { Pool, types } from 'pg'

// Postgres type oids whose default pg parsing differs from what the hosted
// app (Hasura) returns.
const OID_INT8 = 20
const OID_NUMERIC = 1700
const OID_DATE = 1082
const OID_TIMESTAMP = 1114

// A DATE must stay the plain 'YYYY-MM-DD' text Hasura returns. pg's default
// turns it into a JS Date at LOCAL midnight, which toISOString() then shifts
// to the previous day in India (2025-09-01 -> 2025-08-31T18:30:00Z), so
// every date-only field showed a day early in the desktop app.
const keepDateAsText = (oid: number, format?: 'text' | 'binary') =>
  oid === OID_DATE ? (v: string) => v : types.getTypeParser(oid, format)

// GraphQL results (the local stand-in for Hasura's GraphQL API) also return
// numeric / bigint values as JSON numbers, like Hasura does — pg returns
// them as strings, which broke pages calling .toFixed() on a quantity.
// A timestamp WITHOUT time zone stays wall-clock text ('2026-11-11T09:31:56'),
// as Hasura returns it, instead of a Date read in the server's time zone.
const graphqlTypes = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') => {
    if (oid === OID_NUMERIC) return (v: string) => parseFloat(v)
    if (oid === OID_INT8) return (v: string) => Number(v)
    if (oid === OID_TIMESTAMP) return (v: string) => v.replace(' ', 'T')
    return keepDateAsText(oid, format)
  },
}

// Raw SQL (the stand-in for Hasura's run_sql) returns every value as
// Postgres' own text output, exactly like run_sql does: booleans 't'/'f',
// numerics '1.500', timestamps '2026-11-11 09:31:56+00', json as text.
// Callers across the app were written against that format (=== 't',
// Number(cell)), so the direct path must not hand back native values.
const rawTextTypes = {
  getTypeParser: () => (v: string) => v,
}

let pool: Pool | null = null
let graphqlPool: Pool | null = null

function connectionString() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set (required when LOCAL_MODE=true or DIRECT_DB=true)')
  return url
}

// On the web (DIRECT_DB, serverless) keep few connections per instance and
// drop idle ones quickly; Neon's pooler does the real pooling. The desktop
// keeps pg's defaults.
function poolOptions() {
  const serverless = process.env.DIRECT_DB === 'true' && process.env.LOCAL_MODE !== 'true'
  return serverless ? { max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 } : {}
}

function newPool(typeParsers: object): Pool {
  const p = new Pool({ connectionString: connectionString(), types: typeParsers as never, ...poolOptions() })
  // An idle connection dropped by the server (Neon suspends idle compute,
  // its pooler closes idle clients) emits 'error' on the pool. Unhandled,
  // that crashes the whole process; pg replaces the client on next use.
  p.on('error', (err) => console.error('[db] idle connection error:', err.message))
  return p
}

/** Singleton pg.Pool for raw SQL (the direct stand-in for Hasura's run_sql). */
export function getPool(): Pool {
  if (!pool) pool = newPool(rawTextTypes)
  return pool
}

/** Pool for the direct GraphQL engine — values typed the way Hasura's GraphQL API returns them. */
export function getGraphqlPool(): Pool {
  if (!graphqlPool) graphqlPool = newPool(graphqlTypes)
  return graphqlPool
}

/**
 * Closes the singleton pools and clears them, so a later getPool() call opens
 * a fresh one against whatever DATABASE_URL is set at that point. Needed by
 * tests that spin up a new throwaway Postgres instance per file (engine.test.ts)
 * — without this, the pool's connections dangle when that instance shuts
 * down and surface as an unhandled ECONNRESET.
 */
export async function closePool(): Promise<void> {
  const open = [pool, graphqlPool].filter((p): p is Pool => p !== null)
  pool = null
  graphqlPool = null
  await Promise.all(open.map((p) => p.end()))
}
