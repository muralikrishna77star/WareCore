// Unit tests for the Month/Year listing filters shared by the Purchase,
// Sale and Job Work transaction screens. Pure date arithmetic, so no DB —
// the cases that matter are month-end boundaries (28/29/30/31), the
// precedence rule between Month/Year and an explicit from/to, and the
// rejection of out-of-range or junk query params.
import { describe, expect, it } from 'vitest'
import { resolveListingRange, yearOptionsFrom } from '../../src/lib/dateRange'

const defaults = { from: '2026-08-28', to: '2026-09-12' }

describe('resolveListingRange', () => {
  it('falls back to the anchored default window when nothing is set', () => {
    expect(resolveListingRange({}, defaults)).toEqual({
      from: '2026-08-28', to: '2026-09-12', month: '', year: '',
    })
  })

  it('uses an explicit from/to when no month or year is given', () => {
    expect(resolveListingRange({ from: '2025-01-05', to: '2025-02-10' }, defaults)).toEqual({
      from: '2025-01-05', to: '2025-02-10', month: '', year: '',
    })
  })

  it('month + year resolves to that whole calendar month', () => {
    expect(resolveListingRange({ month: '3', year: '2025' }, defaults)).toEqual({
      from: '2025-03-01', to: '2025-03-31', month: '3', year: '2025',
    })
  })

  it('year alone resolves to the whole calendar year', () => {
    expect(resolveListingRange({ year: '2024' }, defaults)).toEqual({
      from: '2024-01-01', to: '2024-12-31', month: '', year: '2024',
    })
  })

  it('month alone borrows the anchor window\u2019s year', () => {
    const r = resolveListingRange({ month: '5' }, defaults)
    expect(r).toEqual({ from: '2026-05-01', to: '2026-05-31', month: '5', year: '2026' })
  })

  it('month/year wins over a stale from/to left in the URL', () => {
    const r = resolveListingRange(
      { from: '2020-01-01', to: '2020-12-31', month: '7', year: '2025' },
      defaults
    )
    expect(r.from).toBe('2025-07-01')
    expect(r.to).toBe('2025-07-31')
  })

  it.each([
    ['2025', '2', '2025-02-28'], // 28-day February
    ['2024', '2', '2024-02-29'], // leap year
    ['2025', '4', '2025-04-30'], // 30-day month
    ['2025', '12', '2025-12-31'], // year end
    ['2025', '1', '2025-01-31'], // year start
  ])('year %s month %s ends on %s', (year, month, expected) => {
    expect(resolveListingRange({ month, year }, defaults).to).toBe(expected)
  })

  it.each(['0', '13', '-1', 'abc', '1.5', ''])('ignores invalid month %s', (month) => {
    const r = resolveListingRange({ month }, defaults)
    expect(r).toEqual({ from: defaults.from, to: defaults.to, month: '', year: '' })
  })

  it.each(['1899', '3000', 'abc', ''])('ignores invalid year %s', (year) => {
    const r = resolveListingRange({ year }, defaults)
    expect(r).toEqual({ from: defaults.from, to: defaults.to, month: '', year: '' })
  })
})

describe('yearOptionsFrom', () => {
  it('spans min..max newest first', () => {
    expect(yearOptionsFrom('2023-04-01', '2026-01-09')).toEqual([2026, 2025, 2024, 2023])
  })

  it('collapses to a single year when all data is in one year', () => {
    expect(yearOptionsFrom('2025-01-01', '2025-12-31')).toEqual([2025])
  })

  it('tolerates reversed bounds', () => {
    expect(yearOptionsFrom('2026-01-01', '2024-01-01')).toEqual([2026, 2025, 2024])
  })

  it('falls back to the current year on an empty table', () => {
    const now = new Date().getUTCFullYear()
    expect(yearOptionsFrom(null, null)).toEqual([now])
    expect(yearOptionsFrom(undefined, undefined)).toEqual([now])
  })
})

describe('yearOptionsFrom mustInclude', () => {
  it('adds a year the data does not reach, so the select can display it', () => {
    // Ledger holds only 2024, but the screen's default period is the current
    // month — the current year must still be selectable.
    expect(yearOptionsFrom('2024-01-01', '2024-12-31', [2026])).toEqual([2026, 2025, 2024])
  })

  it('accepts the year as a string, as the resolver returns it', () => {
    expect(yearOptionsFrom('2024-01-01', '2024-12-31', ['2026'])).toEqual([2026, 2025, 2024])
  })

  it('extends backwards too', () => {
    expect(yearOptionsFrom('2024-01-01', '2024-12-31', [2022])).toEqual([2024, 2023, 2022])
  })

  it('ignores junk and out-of-range years', () => {
    expect(yearOptionsFrom('2024-01-01', '2024-12-31', ['abc', null, undefined, 1800, 3500]))
      .toEqual([2024])
  })

  it('is unchanged when the extra year is already covered', () => {
    expect(yearOptionsFrom('2023-01-01', '2025-12-31', [2024])).toEqual([2025, 2024, 2023])
  })
})
