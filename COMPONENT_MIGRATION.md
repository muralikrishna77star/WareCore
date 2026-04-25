# Converting Components to Use GraphQL

This guide shows how to convert your form components from Supabase to GraphQL (Hasura).

## Example 1: Convert a Form Component

### Before (Supabase):
```typescript
// src/app/(app)/admin/companies/new/AdminCompanyForm.tsx
'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function AdminCompanyForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const supabase = createClient()

    // Supabase insert
    const { data, error: err } = await supabase.from('companies').insert({
      name: formData.get('name'),
      code: formData.get('code'),
      short_name: formData.get('short_name'),
      // ...
    })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    router.push('/admin/companies')
  }

  return (
    <form onSubmit={onSubmit}>
      {/* form fields */}
    </form>
  )
}
```

### After (GraphQL):
```typescript
// src/app/(app)/admin/companies/new/AdminCompanyForm.tsx
'use client'

import { useMutation } from '@urql/next'
import { CREATE_COMPANY_MUTATION } from '@/lib/hasura/queries'
import { useRouter } from 'next/navigation'

export function AdminCompanyForm() {
  const router = useRouter()
  const [, executeMutation] = useMutation(CREATE_COMPANY_MUTATION)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData(e.currentTarget)

    try {
      const result = await executeMutation({
        name: formData.get('name'),
        code: formData.get('code'),
        short_name: formData.get('short_name'),
        // ...
      })

      if (result.error) {
        setError(result.error.message)
        setLoading(false)
        return
      }

      router.push('/admin/companies')
    } catch (err) {
      setError('Failed to create company')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {/* form fields */}
    </form>
  )
}
```

## Example 2: Convert a List Page

### Before (Supabase):
```typescript
// src/app/(app)/bills/page.tsx
import { createClient } from '@/lib/supabase/server'

export default async function BillsPage() {
  const supabase = await createClient()
  
  const { data: bills } = await supabase
    .from('purchase_bills')
    .select('*, suppliers(name), companies(name)')
    .order('bill_date', { ascending: false })

  return (
    <div>
      {bills?.map(bill => (
        <div key={bill.id}>{bill.bill_number}</div>
      ))}
    </div>
  )
}
```

### After (GraphQL):
```typescript
// src/app/(app)/bills/page.tsx
import { hasuraQuery } from '@/lib/hasura/server'
import { PURCHASE_BILLS_QUERY } from '@/lib/hasura/queries'

export default async function BillsPage() {
  const result = await hasuraQuery(PURCHASE_BILLS_QUERY)
  const bills = result.purchase_bills || []

  return (
    <div>
      {bills.map(bill => (
        <div key={bill.id}>{bill.bill_number}</div>
      ))}
    </div>
  )
}
```

## Example 3: Use urql for Client-Side Queries

### Using urql hook (Client Component):
```typescript
'use client'

import { useQuery } from '@urql/next'
import { COMPANIES_QUERY } from '@/lib/hasura/queries'

export function CompanySelector() {
  const [result] = useQuery({
    query: COMPANIES_QUERY,
  })

  const { data, fetching, error } = result

  if (fetching) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  return (
    <select>
      {data?.companies?.map(company => (
        <option key={company.id} value={company.id}>
          {company.name}
        </option>
      ))}
    </select>
  )
}
```

## Example 4: Form with Lookup Data

### Before (Supabase):
```typescript
async function SupplierForm() {
  const supabase = await createClient()
  const { data: companies } = await supabase
    .from('companies').select('id, name')
  
  return (
    <select>
      {companies?.map(c => (
        <option key={c.id}>{c.name}</option>
      ))}
    </select>
  )
}
```

### After (GraphQL):
```typescript
import { hasuraQuery } from '@/lib/hasura/server'
import { COMPANIES_QUERY } from '@/lib/hasura/queries'

async function SupplierForm() {
  const result = await hasuraQuery(COMPANIES_QUERY)
  const companies = result.companies || []
  
  return (
    <select>
      {companies.map(c => (
        <option key={c.id}>{c.name}</option>
      ))}
    </select>
  )
}
```

## Migration Checklist

Use this to track your progress converting components:

### Admin Pages
- [ ] Companies (list & form)
- [ ] Warehouses (list & form)
- [ ] Suppliers (list & form)
- [ ] Customers (list & form)
- [ ] Material Types (list & form)
- [ ] Material Sizes (list & form)
- [ ] Users (list & form)

### Business Pages
- [ ] Dashboard
- [ ] Purchase Bills (list & form)
- [ ] Transfers (list & form)
- [ ] Job Work (list & form)
- [ ] Dispatch (list & form)
- [ ] Inventory (if exists)
- [ ] Reports (if exists)
- [ ] Movements (if exists)

### Authentication
- [ ] Login page
- [ ] Auth middleware
- [ ] Session management

## Key Differences

| Feature | Supabase | GraphQL (Hasura) |
|---------|----------|------------------|
| Query Style | `.from().select()` | GraphQL query string |
| Mutations | `.insert()`, `.update()`, `.delete()` | GraphQL mutations |
| Real-time | `.on('*', callback)` | WebSocket subscriptions |
| Error Handling | `.error` property | `result.error` |
| Auth | Built-in | Requires JWT |

## Tips

1. **Reuse queries** - Store common queries in `lib/hasura/queries.ts`
2. **Create hooks** - Build custom hooks for repeated patterns
3. **Cache data** - Use Next.js `revalidate` or SWR for client-side
4. **Error boundaries** - Add error handling for failed queries
5. **Loading states** - Show spinners while loading
6. **Validation** - Validate on both client and server

## Common Patterns

### Fetch with Error Handling
```typescript
try {
  const result = await hasuraQuery(COMPANIES_QUERY)
  return result.companies || []
} catch (error) {
  console.error('Failed to fetch companies:', error)
  return []
}
```

### Mutation with Success Toast
```typescript
const result = await executeMutation(variables)
if (result.error) {
  showError(result.error.message)
} else {
  showSuccess('Saved successfully')
  router.refresh()
}
```

### Reusable Query Hook
```typescript
// lib/hasura/hooks.ts
export function useCompanies() {
  const [result] = useQuery({ query: COMPANIES_QUERY })
  return result.data?.companies || []
}

// Usage
const companies = useCompanies()
```
