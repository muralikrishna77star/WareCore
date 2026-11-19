/** Calls a tracking route and throws the server's own message on failure. */
export async function trackingApi<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/tracking/${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new Error('Network error. Please check your connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Please try again.')
  return data as T
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

/** Formats a Postgres timestamp for display in India. */
export const formatWhen = (value: string) =>
  new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
