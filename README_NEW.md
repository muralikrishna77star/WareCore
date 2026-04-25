# WareCore - Modern WMS Architecture

WareCore is a comprehensive Warehouse Management System built with cutting-edge technology:

- **Coolify** - Self-hosted deployment platform
- **PostgreSQL** - Robust relational database
- **Hasura** - Instant GraphQL API
- **Next.js** - Modern React framework
- **Capacitor** - Cross-platform mobile

## Quick Start (Local Development)

### Prerequisites

- Docker & Docker Compose
- Node.js 20+
- npm or yarn

### 1. Clone & Install

```bash
cd warecore
npm install
```

### 2. Start Development Stack

```bash
# Windows (PowerShell)
.\setup.ps1

# Or run Docker Compose directly
docker-compose up -d
```

This starts:
- 🐘 PostgreSQL (port 5432)
- 🔷 Hasura GraphQL (http://localhost:8080)
- ⚡ Next.js Dev Server (http://localhost:3000)

### 3. Access the Application

- **App**: http://localhost:3000
- **Hasura Console**: http://localhost:8080
- **Database**: localhost:5432

### 4. Verify Everything Works

```bash
# Test the GraphQL API
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ companies { id name } }"}'
```

## Architecture

```
┌─────────────────────────────────────────────┐
│       User Browser / Mobile App             │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  Next.js Frontend    │ (TailwindCSS)
        │  + Capacitor Mobile  │
        └──────────────┬───────┘
                       │
                       ▼
        ┌──────────────────────┐
        │ Hasura GraphQL API   │
        │  (Real-time queries) │
        └──────────────┬───────┘
                       │
                       ▼
        ┌──────────────────────┐
        │    PostgreSQL        │
        │     Database         │
        └──────────────────────┘

All running in Docker containers,
deployable to Coolify or any Docker host
```

## Project Structure

```
warecore/
├── src/
│   ├── app/                    # Next.js app directory
│   │   ├── (app)/              # Main app routes
│   │   │   ├── admin/          # Admin pages
│   │   │   ├── dashboard/      # Dashboard
│   │   │   ├── bills/          # Purchase bills
│   │   │   ├── transfers/      # Stock transfers
│   │   │   ├── jobwork/        # Job work orders
│   │   │   ├── dispatch/       # Dispatch orders
│   │   │   └── ...
│   │   ├── (website)/          # Public pages
│   │   └── login/              # Authentication
│   ├── lib/
│   │   ├── hasura/             # GraphQL client & queries
│   │   │   ├── client.ts       # Browser client setup
│   │   │   ├── server.ts       # Server-side GraphQL client
│   │   │   └── queries.ts      # All GraphQL queries
│   │   └── utils.ts            # Utilities
│   └── types/
│       └── index.ts            # TypeScript types
├── supabase/
│   └── migrations/             # Database schema (PostgreSQL)
├── public/                      # Static assets
├── docker-compose.yml          # Local dev Docker setup
├── Dockerfile.next             # Next.js production build
├── Dockerfile.postgres         # PostgreSQL custom image
└── docs/
    ├── MIGRATION_GUIDE.md      # Complete migration guide
    ├── HASURA_SETUP.md         # Hasura configuration
    ├── COMPONENT_MIGRATION.md  # Convert components to GraphQL
    └── COOLIFY_DEPLOYMENT.md   # Production deployment
```

## Key Technologies

### Frontend
- **Next.js 16** - React framework with server components
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **urql** - Lightweight GraphQL client
- **Capacitor** - Native mobile wrapper

### Backend
- **Hasura** - GraphQL engine on PostgreSQL
- **PostgreSQL 16** - Advanced relational database
- **GraphQL** - Query language for APIs

### DevOps
- **Docker** - Container orchestration
- **Coolify** - Self-hosted PaaS
- **GitHub Actions** - CI/CD (optional)

## Common Tasks

### View Database

```bash
# PostgreSQL CLI
docker-compose exec postgres psql -U warecore warecore

# Or use pgAdmin (add to docker-compose.yml)
```

### View Hasura Console

Open http://localhost:8080 in your browser

### Run Custom SQL

```sql
-- In Hasura Console → SQL Editor
SELECT * FROM companies ORDER BY name;
```

### Execute GraphQL Query

```graphql
query GetCompanies {
  companies(order_by: {name: asc}) {
    id
    name
    code
    is_active
  }
}
```

### Add New Table

1. Create migration in `supabase/migrations/`
2. Track table in Hasura
3. Use in components via GraphQL query

### Deploy to Production

```bash
# See COOLIFY_DEPLOYMENT.md for full instructions
# Quick: Push to GitHub, Coolify auto-deploys
```

## Database Schema

Key tables in the warehouse management system:

### Master Data
- **companies** - Company/business units
- **warehouses** - Storage facilities
- **suppliers** - Vendor management
- **customers** - Client management
- **material_types** - Product categories
- **material_sizes** - Product specifications

### Operations
- **purchase_bills** - Inbound inventory
- **dispatch_orders** - Outbound shipments
- **transfers** - Inter-warehouse movements
- **job_work_orders** - External processing

### Administration
- **users** - User accounts
- **user_profiles** - User details & roles

All tables include audit fields (created_at, updated_at)

## API Examples

### Query Companies
```typescript
import { hasuraQuery } from '@/lib/hasura/server'
import { COMPANIES_QUERY } from '@/lib/hasura/queries'

const result = await hasuraQuery(COMPANIES_QUERY)
const companies = result.companies
```

### Create Company
```typescript
import { hasuraMutation } from '@/lib/hasura/server'
import { CREATE_COMPANY_MUTATION } from '@/lib/hasura/queries'

const result = await hasuraMutation(CREATE_COMPANY_MUTATION, {
  name: 'ACME Corp',
  code: 'ACME',
})
```

### Client-Side Queries
```typescript
'use client'

import { useQuery } from '@urql/next'
import { COMPANIES_QUERY } from '@/lib/hasura/queries'

export function CompanyList() {
  const [result] = useQuery({ query: COMPANIES_QUERY })
  const { data, fetching, error } = result
  
  // Handle fetching, error, and render data
}
```

## Authentication

Currently in transition from Supabase Auth. Two options:

### Option 1: Development (No Auth)
Use Hasura admin secret for all requests (development only)

### Option 2: Production (JWT)
Implement JWT-based authentication with Hasura

See MIGRATION_GUIDE.md for complete auth setup.

## Performance Tips

1. **Use Pagination** - Add `limit` and `offset` to queries
2. **Select Only Needed Fields** - Reduce bandwidth
3. **Cache Results** - Use Next.js `revalidate`
4. **Add Database Indexes** - For frequently queried columns
5. **Use Relationships** - Join data in GraphQL, not client-side

## Troubleshooting

### Containers won't start
```bash
docker-compose logs
docker-compose down
docker-compose up -d
```

### Database connection error
```bash
docker-compose logs postgres
# Verify DATABASE_URL in .env.local
```

### GraphQL query returns null
```
1. Check table exists: docker-compose exec postgres psql -U warecore warecore
2. Verify table is tracked in Hasura
3. Test in Hasura console GraphiQL
4. Check query syntax
```

### Port already in use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -i :3000
kill -9 <PID>
```

## Environment Variables

Create `.env.local`:

```env
# Hasura
NEXT_PUBLIC_HASURA_URL=http://localhost:8080/v1/graphql
HASURA_ADMIN_SECRET=warecore_admin_secret_dev

# Database
DATABASE_URL=postgresql://warecore:warecore_password_dev@localhost:5432/warecore

# Next.js
NODE_ENV=development
NEXT_PUBLIC_APP_NAME=WareCore
```

For production, see COOLIFY_DEPLOYMENT.md

## Documentation

- 📖 [Complete Migration Guide](MIGRATION_GUIDE.md)
- 🔷 [Hasura Setup & Configuration](HASURA_SETUP.md)
- 🔄 [Convert Components to GraphQL](COMPONENT_MIGRATION.md)
- 🚀 [Coolify Production Deployment](COOLIFY_DEPLOYMENT.md)

## Development

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```

### Build for Production
```bash
npm run build
npm start
```

### Run Linter
```bash
npm run lint
```

## Deployment

### Local Docker
```bash
docker-compose up -d
```

### Coolify
See COOLIFY_DEPLOYMENT.md

### Manual Docker
```bash
docker build -f Dockerfile.next -t warecore:latest .
docker run -p 3000:3000 warecore:latest
```

## Contributing

1. Create feature branch
2. Make changes
3. Test locally
4. Push to GitHub
5. Create Pull Request

## Support & Resources

- **Hasura Docs**: https://hasura.io/docs
- **Next.js Docs**: https://nextjs.org/docs
- **PostgreSQL Docs**: https://www.postgresql.org/docs
- **GraphQL Guide**: https://graphql.org/learn
- **Coolify Docs**: https://coolify.io/docs

## License

[Add your license here]

## Status

✅ Architecture conversion in progress
- [x] Docker setup
- [x] Hasura integration
- [x] GraphQL queries
- [ ] Complete page migration
- [ ] Authentication setup
- [ ] Production deployment

See MIGRATION_GUIDE.md for detailed progress.
