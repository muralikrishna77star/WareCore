const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || process.env.NEXT_PUBLIC_HASURA_ADMIN_SECRET || ''

export async function hasuraQuery(query: string, variables?: Record<string, unknown>) {
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
    console.error('[Hasura] GraphQL error:', message, extensions ? JSON.stringify(extensions, null, 2) : '')
    throw new Error(message)
  }
  return json.data ?? {}
}

export async function hasuraMutation(query: string, variables?: Record<string, unknown>) {
  return hasuraQuery(query, variables)
}
