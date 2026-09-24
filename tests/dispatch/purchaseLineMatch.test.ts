import { describe, it, expect } from 'vitest'
import { purchaseLineMatchesItem } from '@/lib/dispatch/purchaseLineMatch'

const HR = 'type-hr'
const noSizeItem = { id: 'hr00206', material_type_id: HR, material_size_id: null, size_label: null }
const sizedItem = { id: 'hr00100', material_type_id: HR, material_size_id: 'size-a', size_label: '2.00 X 1250' }

describe('purchaseLineMatchesItem', () => {
  it('matches a tagged line only to its own item', () => {
    const line = { item_master_id: 'hr00100', material_type_id: HR, material_size_id: 'size-a', size_label: '2.00 X 1250' }
    expect(purchaseLineMatchesItem(line, sizedItem)).toBe(true)
    expect(purchaseLineMatchesItem(line, noSizeItem)).toBe(false)
  })

  it('does not let a size-less item match every line of its material type', () => {
    const untagged = { item_master_id: null, material_type_id: HR, material_size_id: 'size-a', size_label: '2.00 X 1250' }
    expect(purchaseLineMatchesItem(untagged, noSizeItem)).toBe(false)
  })

  it('falls back to size id or size label for untagged lines', () => {
    expect(purchaseLineMatchesItem({ item_master_id: null, material_type_id: HR, material_size_id: 'size-a', size_label: null }, sizedItem)).toBe(true)
    expect(purchaseLineMatchesItem({ item_master_id: null, material_type_id: HR, material_size_id: null, size_label: '2.00 X 1250' }, sizedItem)).toBe(true)
    expect(purchaseLineMatchesItem({ item_master_id: null, material_type_id: 'type-cr', material_size_id: 'size-a', size_label: null }, sizedItem)).toBe(false)
  })
})
