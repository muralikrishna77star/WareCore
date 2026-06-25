import { executeGraphQL, GraphQLEnvelope } from '@/lib/localdb/executor'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''
const LOCAL_MODE = process.env.LOCAL_MODE === 'true'

/**
 * Runs a GraphQL document against the local Postgres executor (LOCAL_MODE,
 * used by the desktop build) or the remote Hasura endpoint (web). Every
 * direct `fetch(HASURA_URL, ...)` call site should go through this instead,
 * so the desktop/web split stays a single env-driven branch.
 */
export async function hasuraFetchEnvelope<T = any>(
  query: string,
  variables?: Record<string, unknown>
): Promise<GraphQLEnvelope<T>> {
  if (LOCAL_MODE) {
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
