// Client-side Hasura GraphQL fetcher (browser-safe)
// Proxies through /api/graphql — admin secret never exposed to the browser

export async function hasuraFetch<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data: T | null; error: { message: string } | null }> {
  try {
    const res = await fetch('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })

    if (res.status === 401) {
      return { data: null, error: { message: 'Unauthorized' } }
    }

    const json = await res.json()

    if (json.errors) {
      return { data: null, error: { message: json.errors[0]?.message ?? 'GraphQL error' } }
    }

    return { data: json.data as T, error: null }
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : 'Network error' },
    }
  }
}
