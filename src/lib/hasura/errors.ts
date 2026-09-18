// Hasura reports a Postgres RAISE as the opaque top-level message
// "database query error", putting the text the trigger actually wrote in
// extensions.internal.error.message. Several of this app's guards are
// deliberate, human-written RAISEs meant to be read by the person at the
// screen — migration 117's "Job Work dispatch date (X) is before purchase
// line Y was invoiced (Z)" is the clearest example — so showing only the
// top-level text turns a precise explanation into an unactionable one.
//
// extensions.internal also carries the full generated SQL statement, which
// has no business reaching the browser, so lift the message out and drop the
// rest rather than forwarding the envelope as-is.

type HasuraGraphQLError = {
  message?: unknown
  extensions?: { internal?: { error?: { message?: unknown } } }
}

/** The most specific message available for a GraphQL error entry. */
export function graphqlErrorMessage(error: unknown, fallback = 'GraphQL error'): string {
  if (!error || typeof error !== 'object') return fallback
  const { message, extensions } = error as HasuraGraphQLError
  const pgMessage = extensions?.internal?.error?.message
  if (typeof pgMessage === 'string' && pgMessage.trim()) return pgMessage.trim()
  if (typeof message === 'string' && message.trim()) return message.trim()
  return fallback
}

/** Same, for the first entry of a GraphQL `errors` array. */
export function firstGraphQLErrorMessage(errors: unknown, fallback = 'GraphQL error'): string {
  const first = Array.isArray(errors) ? errors[0] : undefined
  return graphqlErrorMessage(first, fallback)
}

/**
 * Rewrites an envelope's errors so each one carries its underlying Postgres
 * message and nothing else — safe to hand to the browser.
 */
export function sanitizeGraphQLErrors(errors: unknown): { message: string }[] | undefined {
  if (!Array.isArray(errors)) return undefined
  return errors.map((e) => ({ message: graphqlErrorMessage(e) }))
}
