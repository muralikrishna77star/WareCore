'use client'

// Shared search box for Admin Master list screens — same visual pattern
// already used on the Users screen (src/app/(app)/admin/users/page.tsx),
// extracted here since every master list (Companies, Warehouses, Suppliers,
// Customers, Material Types, Material Sizes, Tax Rates, Roles) needs it.
// Filtering itself stays local to each screen (different fields per master),
// this component only renders the input.
export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
      </svg>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
    </div>
  )
}
