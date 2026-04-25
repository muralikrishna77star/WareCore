# Quick Reference: Supabase → Hasura Migration

## Side-by-Side Comparison

### Importing the Client

```typescript
// ❌ Old: Supabase
import { createClient } from '@/lib/supabase/server'
const supabase = await createClient()

// ✅ New: Hasura
import { hasuraQuery } from '@/lib/hasura/server'
import { COMPANIES_QUERY } from '@/lib/hasura/queries'
```

### Querying Data

```typescript
// ❌ Old: Supabase
const { data } = await supabase
  .from('companies')
  .select('*')
  .order('name')

// ✅ New: Hasura
const result = await hasuraQuery(COMPANIES_QUERY)
const data = result.companies
```

### Querying with Joins

```typescript
// ❌ Old: Supabase
const { data } = await supabase
  .from('warehouses')
  .select('*, companies(name)')
  .order('name')

// ✅ New: Hasura
const result = await hasuraQuery(WAREHOUSES_QUERY)
const data = result.warehouses
// Join relationships automatically available!
```

### Filtering Data

```typescript
// ❌ Old: Supabase
const { data } = await supabase
  .from('purchase_bills')
  .select('*')
  .eq('status', 'pending')

// ✅ New: Hasura (add to query)
query GetBills {
  purchase_bills(where: {status: {_eq: "pending"}}) {
    id
    bill_number
  }
}
```

### Counting Records

```typescript
// ❌ Old: Supabase
const { count } = await supabase
  .from('companies')
  .select('*', { count: 'exact', head: true })

// ✅ New: Hasura
query CountCompanies {
  companies_aggregate {
    aggregate {
      count
    }
  }
}
```

### Creating Records

```typescript
// ❌ Old: Supabase
const { data, error } = await supabase
  .from('companies')
  .insert({
    name: 'ACME',
    code: 'ACME',
  })

// ✅ New: Hasura
const result = await hasuraMutation(CREATE_COMPANY_MUTATION, {
  name: 'ACME',
  code: 'ACME',
})
```

### Updating Records

```typescript
// ❌ Old: Supabase
const { data, error } = await supabase
  .from('companies')
  .update({ name: 'New Name' })
  .eq('id', companyId)

// ✅ New: Hasura (define mutation in queries.ts)
mutation UpdateCompany {
  update_companies_by_pk(
    pk_columns: {id: "uuid"}
    _set: {name: "New Name"}
  ) {
    id
    name
  }
}
```

### Deleting Records

```typescript
// ❌ Old: Supabase
const { error } = await supabase
  .from('companies')
  .delete()
  .eq('id', companyId)

// ✅ New: Hasura
mutation DeleteCompany {
  delete_companies_by_pk(id: "uuid") {
    id
  }
}
```

### Error Handling

```typescript
// ❌ Old: Supabase
const { data, error } = await supabase.from('companies').select('*')
if (error) {
  console.error(error.message)
}

// ✅ New: Hasura
try {
  const result = await hasuraQuery(COMPANIES_QUERY)
  const companies = result.companies
} catch (error) {
  console.error('Failed:', error.message)
}
```

## File Locations

| Purpose | Supabase | Hasura |
|---------|----------|--------|
| Server Client | `lib/supabase/server.ts` | `lib/hasura/server.ts` |
| Browser Client | `lib/supabase/client.ts` | `lib/hasura/client.ts` |
| Queries | Component files | `lib/hasura/queries.ts` |
| Types | `types/index.ts` | `types/index.ts` |

## Key Query Files

All GraphQL queries are centralized in:
```
src/lib/hasura/queries.ts
```

Organized by purpose:
- `*_QUERY` - Data retrieval queries
- `*_MUTATION` - Data modification mutations
- Exports for easy import in components

## Common Query Patterns

### Get All Records
```typescript
const result = await hasuraQuery(COMPANIES_QUERY)
const companies = result.companies || []
```

### Get Single Record
```graphql
query GetCompany($id: uuid!) {
  companies_by_pk(id: $id) {
    id
    name
  }
}
```

### Get with Pagination
```graphql
query GetCompanies($limit: Int!, $offset: Int!) {
  companies(
    order_by: {name: asc}
    limit: $limit
    offset: $offset
  ) {
    id
    name
  }
}
```

### Get with Aggregation
```graphql
query GetStats {
  purchase_bills_aggregate {
    aggregate {
      count
      sum {
        total_amount
      }
    }
  }
}
```

## Component Update Checklist

When converting a component:

- [ ] Remove `import { createClient } from '@/lib/supabase/server'`
- [ ] Add `import { hasuraQuery } from '@/lib/hasura/server'`
- [ ] Add `import { QUERY_NAME } from '@/lib/hasura/queries'`
- [ ] Replace `.from('table').select()` with `hasuraQuery(QUERY_NAME)`
- [ ] Access data via `result.tableName` instead of `data`
- [ ] Test GraphQL query in Hasura console first
- [ ] Update error handling
- [ ] Remove `| null` type guards if using nullish coalescing

## Tips & Tricks

### 1. Test Queries First
Always test in Hasura console GraphiQL before using in code

### 2. Use Variables for Type Safety
```graphql
query GetCompany($id: uuid!) {  # $id is typed
  companies_by_pk(id: $id) {
    id
    name
  }
}
```

### 3. Reuse Query Definitions
Define once in `queries.ts`, import everywhere:
```typescript
export const COMPANIES_QUERY = `...`  // Define once

// Use in multiple components
const result = await hasuraQuery(COMPANIES_QUERY)
```

### 4. Create Helper Functions
```typescript
export async function getCompanies() {
  return hasuraQuery(COMPANIES_QUERY)
}

export async function getCompanyById(id: string) {
  return hasuraQuery(GET_COMPANY_QUERY, { id })
}
```

### 5. Handle Multiple Queries
```typescript
// Parallel queries
const [companies, warehouses, suppliers] = await Promise.all([
  hasuraQuery(COMPANIES_QUERY),
  hasuraQuery(WAREHOUSES_QUERY),
  hasuraQuery(SUPPLIERS_QUERY),
])
```

## Environment Variables

Update your `.env.local`:

```env
# ❌ Remove these:
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# ✅ Add these:
NEXT_PUBLIC_HASURA_URL=http://localhost:8080/v1/graphql
HASURA_ADMIN_SECRET=warecore_admin_secret_dev
DATABASE_URL=postgresql://warecore:warecore_password_dev@localhost:5432/warecore
```

## Running Migrations

### Add New Migration

Create `supabase/migrations/003_new_feature.sql`:
```sql
ALTER TABLE companies ADD COLUMN new_field TEXT;
```

Then restart containers:
```bash
docker-compose down
docker-compose up -d
```

### Create Initial Schema

Schema is automatically created from existing migrations when PostgreSQL starts

## Debugging

### Check What's in Hasura
Visit http://localhost:8080 → Data → SQL Editor
- See all tables
- See table structure
- Create custom SQL queries

### Test Queries
Visit http://localhost:8080 → API → GraphiQL
- Test queries interactively
- See results in real-time
- Validate syntax

### View Database Directly
```bash
docker-compose exec postgres psql -U warecore warecore
```

## Migration Workflow

1. **Identify Page** - Pick a page using Supabase
2. **Find Query** - Locate `.from().select()` calls
3. **Create GraphQL Query** - Add to `queries.ts`
4. **Update Import** - Replace Supabase with Hasura
5. **Test in Console** - Verify in Hasura GraphiQL
6. **Update Component** - Use new query
7. **Test Component** - Ensure it works

## Quick Links

- Hasura Console: http://localhost:8080
- GraphQL IDE: http://localhost:8080/api/graphql
- Next.js App: http://localhost:3000
- Database: localhost:5432

## Useful Commands

```bash
# View all containers
docker-compose ps

# View logs
docker-compose logs -f hasura

# Open database
docker-compose exec postgres psql -U warecore warecore

# Stop all containers
docker-compose down

# Remove all data (fresh start)
docker-compose down -v
```

---

**Need help?** See the detailed guides:
- MIGRATION_GUIDE.md
- HASURA_SETUP.md  
- COMPONENT_MIGRATION.md
