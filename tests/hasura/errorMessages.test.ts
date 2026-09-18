import { describe, it, expect } from 'vitest'
import { firstGraphQLErrorMessage, sanitizeGraphQLErrors } from '@/lib/hasura/errors'

const realEnvelope = [{
  message: 'database query error',
  extensions: {
    path: '$.selectionSet.insert_job_work_orders_one',
    code: 'unexpected',
    internal: {
      error: { message: 'Job Work dispatch date (2025-01-15) is before purchase line CR0125-0076 was invoiced (2025-01-31) — the material did not exist yet.', status_code: 'P0001' },
      statement: 'WITH "_mra__job_work_items" AS (INSERT INTO ...)',
    },
  },
}]

describe('hasura error messages', () => {
  it('lifts the Postgres trigger message', () => {
    expect(firstGraphQLErrorMessage(realEnvelope)).toContain('is before purchase line CR0125-0076 was invoiced')
  })
  it('drops the generated SQL', () => {
    expect(JSON.stringify(sanitizeGraphQLErrors(realEnvelope))).not.toContain('INSERT INTO')
  })
  it('falls back to the plain message', () => {
    expect(firstGraphQLErrorMessage([{ message: 'field not found' }])).toBe('field not found')
  })
  it('handles empty/garbage', () => {
    expect(firstGraphQLErrorMessage(undefined)).toBe('GraphQL error')
    expect(firstGraphQLErrorMessage([])).toBe('GraphQL error')
  })
})
