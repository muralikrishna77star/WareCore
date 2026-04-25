# WareCore Architecture Migration Guide

## Migration from Supabase → PostgreSQL + Hasura + Coolify

This guide walks you through converting your WareCore warehouse management system to use the modern architecture stack: Coolify for deployment, PostgreSQL for the database, Hasura for GraphQL API, Next.js for the frontend, and Capacitor for mobile.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Coolify                             │
│  (Deployment & Orchestration Platform)                  │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ PostgreSQL   │  │   Hasura     │  │   Next.js    │  │
│  │  (Database)  │◄─┤  (GraphQL)   │◄─┤  (Frontend)  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                           ▲                               │
│                           │                               │
│                    ┌──────┴──────┐                        │
│                    │  Capacitor  │                        │
│                    │  (Mobile)   │                        │
│                    └─────────────┘                        │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

## Phase 1: Local Development Setup

### Prerequisites
- Docker Desktop (Windows, Mac) or Docker Engine (Linux)
- Node.js 20+
- npm or yarn

### Step 1: Initialize Docker Environment

```bash
# Copy environment file
cp .env.local.example .env.local

# Start the Docker containers (PostgreSQL, Hasura, Next.js)
docker-compose up -d
```

This will start:
- **PostgreSQL** on port 5432
- **Hasura GraphQL Console** on http://localhost:8080
- **Next.js Development Server** on http://localhost:3000

### Step 2: Access Hasura Console

1. Open http://localhost:8080 in your browser
2. You'll see the Hasura GraphQL Console
3. Click on the "Data" tab to start setting up metadata

### Step 3: Configure Database Tables in Hasura

The database schema will be automatically created from the migration files in `supabase/migrations/`. Hasura will automatically detect all tables.

**To enable GraphQL on tables:**
1. Go to Hasura Console → Data → SQL Editor
2. Run the migration files if they haven't been applied yet
3. Go to Data → Track tables to expose them via GraphQL

### Step 4: Update API Calls in Your Components

Replace Supabase calls with GraphQL queries:

**Before (Supabase):**
```typescript
const supabase = await createClient()
const { data: companies } = await supabase
  .from('companies')
  .select('*')
  .order('name')
```

**After (Hasura):**
```typescript
import { hasuraQuery } from '@/lib/hasura/server'
import { COMPANIES_QUERY } from '@/lib/hasura/queries'

const result = await hasuraQuery(COMPANIES_QUERY)
const companies = result.companies
```

## Phase 2: GraphQL Integration

### Querying Data (Server-Side)

```typescript
// In your async Server Component
import { hasuraQuery } from '@/lib/hasura/server'
import { COMPANIES_QUERY } from '@/lib/hasura/queries'

export default async function MyComponent() {
  const result = await hasuraQuery(COMPANIES_QUERY)
  const companies = result.companies

  return (
    // your JSX
  )
}
```

### Mutations (Form Submissions)

```typescript
import { hasuraMutation } from '@/lib/hasura/server'
import { CREATE_COMPANY_MUTATION } from '@/lib/hasura/queries'

const result = await hasuraMutation(CREATE_COMPANY_MUTATION, {
  name: formData.name,
  code: formData.code,
  // ... other fields
})
```

### Client-Side Data Fetching (if needed)

For client components that need real-time data or interactive features:

```typescript
'use client'

import { useQuery, useMutation } from '@urql/next'
import { COMPANIES_QUERY, UPDATE_COMPANY_MUTATION } from '@/lib/hasura/queries'

export function CompanyList() {
  const [result] = useQuery({
    query: COMPANIES_QUERY,
  })

  if (result.fetching) return <div>Loading...</div>
  if (result.error) return <div>Error: {result.error.message}</div>

  return (
    // render result.data.companies
  )
}
```

## Phase 3: Authentication

### Migration from Supabase Auth

Currently, authentication needs to be updated. You have two options:

#### Option A: Hasura with JWT (Recommended)
1. Create a custom authentication endpoint
2. Issue JWT tokens on login
3. Store token in localStorage
4. Pass token to Hasura in GraphQL headers

#### Option B: Custom Auth Provider
Implement your own authentication with a backend service.

**Temporary Solution for Development:**
- Comment out auth checks
- Use Hasura admin secret for all requests (development only)
- Implement proper auth before production

## Phase 4: Database Migrations

The existing Supabase migration files are used:
- `supabase/migrations/001_initial_schema.sql` - Main schema
- `supabase/migrations/002_rls_policies.sql` - Row Level Security

These are automatically run when the PostgreSQL container starts.

### Adding New Migrations

```sql
-- Create new file: supabase/migrations/003_new_feature.sql
ALTER TABLE companies ADD COLUMN new_column TEXT;
```

Then restart the Docker containers:
```bash
docker-compose down
docker-compose up -d
```

## Phase 5: Form Components Migration

### Example: Update Admin Company Form

**Old Supabase approach:**
```typescript
const supabase = await createClient()
await supabase.from('companies').insert(formData)
```

**New Hasura approach:**
```typescript
import { hasuraMutation } from '@/lib/hasura/server'
import { CREATE_COMPANY_MUTATION } from '@/lib/hasura/queries'

await hasuraMutation(CREATE_COMPANY_MUTATION, {
  name: formData.name,
  code: formData.code,
  // ...
})
```

## Phase 6: Environment Variables

Update `.env.local`:

```env
# Hasura Configuration
NEXT_PUBLIC_HASURA_URL=http://localhost:8080/v1/graphql
HASURA_ADMIN_SECRET=warecore_admin_secret_dev

# Production
# NEXT_PUBLIC_HASURA_URL=https://your-hasura-domain.com/v1/graphql
# HASURA_ADMIN_SECRET=your-production-secret

# Database (for local development)
DATABASE_URL=postgresql://warecore:warecore_password_dev@localhost:5432/warecore
```

## Phase 7: Production Deployment with Coolify

### Prerequisites
- Coolify instance running (self-hosted or cloud)
- PostgreSQL database (managed or Docker)
- Domain name

### Step 1: Prepare Coolify Configuration

Create `coolify.json`:
```json
{
  "services": {
    "postgres": {
      "image": "postgres:16-alpine",
      "environment": {
        "POSTGRES_DB": "warecore",
        "POSTGRES_USER": "warecore"
      }
    },
    "hasura": {
      "image": "hasura/graphql-engine:latest",
      "depends_on": ["postgres"]
    },
    "next": {
      "build": {
        "dockerfile": "Dockerfile.next"
      }
    }
  }
}
```

### Step 2: Deploy to Coolify

1. Connect your GitHub repository to Coolify
2. Select the WareCore repository
3. Configure environment variables
4. Deploy!

### Step 3: Configure Custom Domain

In Coolify dashboard:
1. Navigate to your application
2. Add custom domain
3. Configure SSL certificate (Let's Encrypt)

## Phase 8: Capacitor Mobile Build

Capacitor should work seamlessly with the GraphQL API:

```typescript
// In your Capacitor app
const response = await fetch('https://your-domain.com/v1/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: COMPANIES_QUERY,
  }),
})
```

## Testing Checklist

- [ ] All master data pages load correctly
- [ ] CRUD operations work for all entities
- [ ] Dashboard displays correct statistics
- [ ] Authentication flow works
- [ ] Mobile app builds and connects to API
- [ ] Data mutations save correctly
- [ ] Pagination works (if implemented)
- [ ] Real-time data updates (if needed)

## Troubleshooting

### Hasura Console not accessible
```bash
# Check if containers are running
docker-compose ps

# View logs
docker-compose logs hasura
```

### Database connection errors
```bash
# Check PostgreSQL is healthy
docker-compose logs postgres

# Verify DATABASE_URL is correct
echo $DATABASE_URL
```

### GraphQL query errors
1. Check Hasura Console → GraphiQL
2. Verify query syntax
3. Check table permissions in Hasura
4. Review database schema

### Build errors
```bash
# Clean node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Rebuild Docker images
docker-compose build --no-cache
```

## Next Steps

1. **Complete the phase migration** - Update all remaining pages to use GraphQL
2. **Implement authentication** - Set up proper JWT-based auth with Hasura
3. **Configure RLS policies** - Set up row-level security in PostgreSQL
4. **Set up CI/CD** - Use Coolify's GitHub integration for automatic deployments
5. **Performance optimization** - Add database indexes and optimize GraphQL queries
6. **Monitoring** - Set up logging and error tracking

## Support

For issues:
1. Check Hasura documentation: https://hasura.io/docs/
2. Review Next.js GraphQL integration: https://nextjs.org/docs
3. Capacitor documentation: https://capacitorjs.com/docs
4. Coolify documentation: https://coolify.io/docs
