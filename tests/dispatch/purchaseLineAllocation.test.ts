import { describe, it, expect } from 'vitest'
import {
  allocationByPurchaseLine,
  overAllocationFor,
  purchaseLineOverAllocationWarnings,
} from '@/lib/dispatch/purchaseLineAllocation'

const balances = [
  { _key: 'CR0125-0076', purchase_line_id: 'CR0125-0076', available_quantity: 3.48 },
  { _key: 'CR0125-0077', purchase_line_id: 'CR0125-0077', available_quantity: 3.26 },
  { _key: 'ID:abc', purchase_line_id: null, available_quantity: 1.0 },
]

describe('purchase line allocation', () => {
  it('sums several sale lines drawing on the same purchase line', () => {
    const lines = [
      { purchase_line_id: 'CR0125-0076', quantity: '2.000' },
      { purchase_line_id: 'CR0125-0076', quantity: '2.000' },
    ]
    expect(allocationByPurchaseLine(lines).get('CR0125-0076')).toBeCloseTo(4.0, 5)
  })

  it('flags the pair that individually looked fine', () => {
    const lines = [
      { purchase_line_id: 'CR0125-0076', quantity: '2.000' },
      { purchase_line_id: 'CR0125-0076', quantity: '2.000' },
    ]
    // Each row alone is under 3.480, so a per-row check would pass both.
    expect(lines.every(l => parseFloat(l.quantity) <= 3.48)).toBe(true)
    const warnings = purchaseLineOverAllocationWarnings(lines, balances)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('CR0125-0076')
    expect(warnings[0]).toContain('4.000')
    expect(warnings[0]).toContain('across 2 lines')
    expect(warnings[0]).toContain('3.480')
  })

  it('allows a split that fits exactly', () => {
    const lines = [
      { purchase_line_id: 'CR0125-0076', quantity: '1.480' },
      { purchase_line_id: 'CR0125-0076', quantity: '2.000' },
    ]
    expect(purchaseLineOverAllocationWarnings(lines, balances)).toEqual([])
  })

  it('does not warn on floating-point dust', () => {
    const lines = [
      { purchase_line_id: 'CR0125-0076', quantity: '1.1' },
      { purchase_line_id: 'CR0125-0076', quantity: '2.2' },
      { purchase_line_id: 'CR0125-0076', quantity: '0.18' },
    ]
    expect(purchaseLineOverAllocationWarnings(lines, balances)).toEqual([])
  })

  it('reports each over-allocated purchase line separately', () => {
    const lines = [
      { purchase_line_id: 'CR0125-0076', quantity: '4.000' },
      { purchase_line_id: 'CR0125-0077', quantity: '9.000' },
    ]
    expect(purchaseLineOverAllocationWarnings(lines, balances)).toHaveLength(2)
  })

  it('names unlinked stock by item rather than a null purchase line id', () => {
    const lines = [{ purchase_line_id: 'ID:abc', quantity: '5', item_name: 'CR 2.30 X 377' }]
    const [warning] = purchaseLineOverAllocationWarnings(lines, balances)
    expect(warning).toContain('CR 2.30 X 377')
    expect(warning).not.toContain('null')
  })

  it('ignores rows with no purchase line picked', () => {
    const lines = [{ purchase_line_id: '', quantity: '99' }]
    expect(purchaseLineOverAllocationWarnings(lines, balances)).toEqual([])
    expect(allocationByPurchaseLine(lines).size).toBe(0)
  })

  it('ignores a key with no balance on file', () => {
    const lines = [{ purchase_line_id: 'UNKNOWN-0001', quantity: '99' }]
    expect(purchaseLineOverAllocationWarnings(lines, balances)).toEqual([])
  })

  it('treats blank and unparseable quantities as zero', () => {
    const lines = [
      { purchase_line_id: 'CR0125-0076', quantity: '' },
      { purchase_line_id: 'CR0125-0076', quantity: 'abc' },
    ]
    expect(allocationByPurchaseLine(lines).get('CR0125-0076')).toBe(0)
    expect(purchaseLineOverAllocationWarnings(lines, balances)).toEqual([])
  })

  it('overAllocationFor reports the shortfall for one line', () => {
    const lines = [
      { purchase_line_id: 'CR0125-0076', quantity: '2.000' },
      { purchase_line_id: 'CR0125-0076', quantity: '2.000' },
    ]
    expect(overAllocationFor('CR0125-0076', lines, balances)).toBeCloseTo(0.52, 5)
    expect(overAllocationFor('CR0125-0077', lines, balances)).toBe(0)
    expect(overAllocationFor('', lines, balances)).toBe(0)
  })
})
