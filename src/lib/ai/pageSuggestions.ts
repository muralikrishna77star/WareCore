export type PageSuggestions = {
  label: string
  suggestions: string[]
}

const PAGE_SUGGESTIONS: { prefix: string; label: string; suggestions: string[] }[] = [
  {
    prefix: '/dashboard',
    label: 'Dashboard',
    suggestions: ["Today's Stock", 'Low Stock', "Today's Transfers", 'Inventory Summary', "Today's Purchases"],
  },
  {
    prefix: '/inventory',
    label: 'Inventory',
    suggestions: ['Current Stock', 'Negative Stock', 'Recalculate Stock', 'Item Ledger', 'Warehouse Summary'],
  },
  {
    prefix: '/bills',
    label: 'Purchase Entry',
    suggestions: ['Create Purchase', 'Last Purchase', 'Purchase History', 'Supplier History', 'Pending Bills'],
  },
  {
    prefix: '/dispatch',
    label: 'Sale Entry',
    suggestions: ["Today's Sales", 'Customer Sales', 'Create Sale', 'Sales History'],
  },
  {
    prefix: '/transfers',
    label: 'Transfers',
    suggestions: ['Create Transfer', 'Transfer History', 'Pending Transfers', 'Warehouse Transfer'],
  },
  {
    prefix: '/jobwork',
    label: 'Job Work',
    suggestions: ['Pending Job Work', 'Vendor Stock', 'Receive Material', 'Send Material'],
  },
  {
    prefix: '/reports',
    label: 'Reports',
    suggestions: ['Stock Statement', 'Stock Ledger', 'Dead Stock', 'Fast Moving', 'Inventory Valuation'],
  },
]

const DEFAULT_SUGGESTIONS: PageSuggestions = {
  label: 'WareCore',
  suggestions: ['What can I do here?', 'Explain this screen', 'Go to Dashboard'],
}

export function getPageSuggestions(pathname: string): PageSuggestions {
  const match = PAGE_SUGGESTIONS.find(
    (p) => pathname === p.prefix || pathname.startsWith(p.prefix + '/')
  )
  if (!match) return DEFAULT_SUGGESTIONS
  return { label: match.label, suggestions: match.suggestions }
}
