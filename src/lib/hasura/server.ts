import { hasuraFetchEnvelope } from './transport'
import { runSqlLocal } from '@/lib/localdb/sql'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || process.env.NEXT_PUBLIC_HASURA_ADMIN_SECRET || ''
const HASURA_SQL_URL = HASURA_URL.replace('/v1/graphql', '/v2/query')
const LOCAL_MODE = process.env.LOCAL_MODE === 'true'

export async function hasuraQuery(
  query: string,
  variables?: Record<string, unknown>,
  options?: { suppressError?: boolean }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const json = await hasuraFetchEnvelope(query, variables)
  if (json.errors) {
    const firstError = json.errors[0]
    const message = firstError?.message ?? 'Hasura query failed'
    if (!options?.suppressError) {
      console.error('[Hasura] GraphQL error:', message)
    }
    throw new Error(message)
  }
  return json.data ?? {}
}

export async function hasuraMutation(query: string, variables?: Record<string, unknown>) {
  return hasuraQuery(query, variables)
}

/** Call a PostgreSQL function via Hasura's admin SQL endpoint (fully transactional). */
export async function hasuraRunSql(sql: string): Promise<{ result: string[][] }> {
  if (LOCAL_MODE) {
    return runSqlLocal(sql) as Promise<{ result: string[][] }>
  }

  const res = await fetch(HASURA_SQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify({
      type: 'run_sql',
      args: { source: 'warecore', sql, cascade: false, read_only: false },
    }),
    cache: 'no-store',
  })
  const json = await res.json()
  if (!res.ok || json.error) {
    const detail = json.internal?.error?.message ?? json.internal?.error?.description ?? ''
    const msg = `${json.error ?? json.message ?? 'SQL execution failed'}${detail ? `: ${detail}` : ''}`
    throw new Error(msg)
  }
  return json
}
