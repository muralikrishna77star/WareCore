import { Pool, types } from 'pg'

// Postgres type oids whose default pg parsing differs from what the hosted
// app (Hasura) returns.
const OID_INT8 = 20
const OID_NUMERIC = 1700
const OID_DATE = 1082

// A DATE must stay the plain 'YYYY-MM-DD' text Hasura returns. pg's default
// turns it into a JS Date at LOCAL midnight, which toISOString() then shifts
// to the previous day in India (2025-09-01 -> 2025-08-31T18:30:00Z), so
// every date-only field showed a day early in the desktop app.
const keepDateAsText = (oid: number, format?: 'text' | 'binary') =>
  oid === OID_DATE ? (v: string) => v : types.getTypeParser(oid, format)

// GraphQL results (the local stand-in for Hasura's GraphQL API) also return
// numeric / bigint values as JSON numbers, like Hasura does — pg returns
// them as strings, which broke pages calling .toFixed() on a quantity.
const graphqlTypes = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') => {
    if (oid === OID_NUMERIC) return (v: string) => parseFloat(v)
    if (oid === OID_INT8) return (v: string) => Number(v)
    return keepDateAsText(oid, format)
  },
}

let pool: Pool | null = null
let graphqlPool: Pool | null = null

function connectionString() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set (required when LOCAL_MODE=true)')
  return url
}

/** Singleton pg.Pool for LOCAL_MODE raw SQL (the local stand-in for Hasura's run_sql). */
export function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: connectionString(), types: { getTypeParser: keepDateAsText } as never })
  return pool
}

/** Pool for the local GraphQL engine — values typed the way Hasura's GraphQL API returns them. */
export function getGraphqlPool(): Pool {
  if (!graphqlPool) graphqlPool = new Pool({ connectionString: connectionString(), types: graphqlTypes as never })
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
