const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || process.env.NEXT_PUBLIC_HASURA_ADMIN_SECRET || ''
const HASURA_SQL_URL = HASURA_URL.replace('/v1/graphql', '/v2/query')

export async function hasuraQuery(
  query: string,
  variables?: Record<string, unknown>,
  options?: { suppressError?: boolean }
) {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  })
  const json = await res.json()
  if (json.errors) {
    const firstError = json.errors[0]
    const message = firstError?.message ?? 'Hasura query failed'
    const extensions = firstError?.extensions
    if (!options?.suppressError) {
      console.error('[Hasura] GraphQL error:', message, extensions ? JSON.stringify(extensions, null, 2) : '')
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
    throw new Error(json.error ?? json.message ?? 'SQL execution failed')
  }
  return json
}
