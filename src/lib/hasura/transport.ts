import { executeGraphQL, GraphQLEnvelope } from '@/lib/localdb/executor'
import { DIRECT_DB } from '@/lib/dbMode'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''

/**
 * Runs a GraphQL document against the direct Postgres executor (desktop
 * LOCAL_MODE, or the web app with DIRECT_DB=true) or the remote Hasura endpoint. Every
 * direct `fetch(HASURA_URL, ...)` call site should go through this instead,
 * so the desktop/web split stays a single env-driven branch.
 */
export async function hasuraFetchEnvelope<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<GraphQLEnvelope<T>> {
  if (DIRECT_DB) {
    return executeGraphQL<T>(query, variables)
  }
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  })
  return res.json()
}
