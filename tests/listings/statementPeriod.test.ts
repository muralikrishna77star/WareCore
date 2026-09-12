// Unit tests for the Daywise Stock Statement's period resolver. The rules
// that matter: a finished month runs to its own month-end, the CURRENT
// month stops at today, and a From/To the user edited afterwards turns the
// period into a custom range rather than being overridden by the month.
import { describe, expect, it } from 'vitest'
import { resolveStatementPeriod } from '../../src/lib/dateRange'

// Fixed "today" so the current-month rule is deterministic.
const TODAY = new Date(2026, 8, 12) // 12 September 2026 (month is 0-based)

describe('resolveStatementPeriod', () => {
  it('defaults to the current month through today', () => {
    const p = resolveStatementPeriod({}, TODAY)
    expect(p).toEqual({
      from: '2026-09-01',
      to: '2026-09-12',
      month: '9',
      year: '2026',
      mode: 'month',
      label: 'September 2026',
    })
  })

  it('runs a completed historical month to its own month end', () => {
    const p = resolveStatementPeriod({ month: '11', year: '2024' }, TODAY)
    expect(p.from).toBe('2024-11-01')
    expect(p.to).toBe('2024-11-30')
    expect(p.mode).toBe('month')
    expect(p.label).toBe('November 2024')
  })

  it('stops the current month at today, not at month end', () => {
    const p = resolveStatementPeriod({ month: '9', year: '2026' }, TODAY)
    expect(p.from).toBe('2026-09-01')
    expect(p.to).toBe('2026-09-12') // not 2026-09-30
    expect(p.mode).toBe('month')
  })

  it('handles February in a leap year', () => {
    expect(resolveStatementPeriod({ month: '2', year: '2024' }, TODAY).to).toBe('2024-02-29')
    expect(resolveStatementPeriod({ month: '2', year: '2025' }, TODAY).to).toBe('2025-02-28')
  })

  it('stays in month mode when From/To match the resolved month', () => {
    // What an untouched re-submit sends: the inputs still hold the month's own dates.
    const p = resolveStatementPeriod(
      { month: '11', year: '2024', from: '2024-11-01', to: '2024-11-30' },
      TODAY
    )
    expect(p.mode).toBe('month')
    expect(p.label).toBe('November 2024')
  })

  it('switches to a custom range when the user edits the To date', () => {
    const p = resolveStatementPeriod(
      { month: '11', year: '2024', from: '2024-11-01', to: '2024-11-15' },
      TODAY
    )
    expect(p.mode).toBe('custom')
    expect(p.from).toBe('2024-11-01')
    expect(p.to).toBe('2024-11-15')
    expect(p.month).toBe('')
    expect(p.year).toBe('')
  })

  it('switches to a custom range when the user edits the From date', () => {
    const p = resolveStatementPeriod(
      { month: '11', year: '2024', from: '2024-11-10', to: '2024-11-30' },
      TODAY
    )
    expect(p.mode).toBe('custom')
    expect(p.from).toBe('2024-11-10')
  })

  it('treats a bare From/To with no month as a custom range', () => {
    const p = resolveStatementPeriod({ from: '2024-03-05', to: '2024-04-09' }, TODAY)
    expect(p.mode).toBe('custom')
    expect(p.from).toBe('2024-03-05')
    expect(p.to).toBe('2024-04-09')
  })

  it('fills the missing half of a one-sided custom range', () => {
    expect(resolveStatementPeriod({ from: '2024-03-05' }, TODAY).to).toBe('2026-09-12')
    expect(resolveStatementPeriod({ to: '2026-09-09' }, TODAY).from).toBe('2026-09-01')
  })

  it('takes the current year when only a month is given', () => {
    const p = resolveStatementPeriod({ month: '3' }, TODAY)
    expect(p.from).toBe('2026-03-01')
    expect(p.to).toBe('2026-03-31')
    expect(p.label).toBe('March 2026')
  })

  it('takes the current month when only a year is given', () => {
    const p = resolveStatementPeriod({ year: '2024' }, TODAY)
    expect(p.from).toBe('2024-09-01')
    expect(p.to).toBe('2024-09-30')
  })

  it.each(['0', '13', 'abc', ''])('ignores an invalid month %s', (month) => {
    const p = resolveStatementPeriod({ month }, TODAY)
    expect(p.from).toBe('2026-09-01')
    expect(p.to).toBe('2026-09-12')
  })

  it('never returns a To earlier than its From', () => {
    for (const m of ['1', '2', '6', '9', '12']) {
      const p = resolveStatementPeriod({ month: m, year: '2026' }, TODAY)
      expect(p.to >= p.from, `${m}: ${p.from}..${p.to}`).toBe(true)
    }
  })

  it('never lets a selected month run past today', () => {
    // A future month in the current year still must not project forward.
    const p = resolveStatementPeriod({ month: '12', year: '2026' }, TODAY)
    expect(p.from).toBe('2026-12-01')
    // December 2026 is not the current month, so it keeps its natural end.
    expect(p.to).toBe('2026-12-31')
  })
})
