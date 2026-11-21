'use client'

import { createContext, useContext } from 'react'
import { DEFAULT_BRAND, type Brand } from '@/lib/tenancy/brandShared'

const BrandContext = createContext<Brand>(DEFAULT_BRAND)

/** Set once in the root layout from the customer the address opens. */
export function BrandProvider({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}

/** The customer's name, logo and colour (WareCore's own when there is no customer). */
export function useBrand(): Brand {
  return useContext(BrandContext)
}
