# WareCore - Modern Warehouse Management System

🚀 **WareCore** has been converted to a modern, scalable architecture using:
- **Coolify** - Self-hosted deployment platform
- **PostgreSQL** - Robust database
- **Hasura** - Instant GraphQL API
- **Next.js** - React frontend framework
- **Capacitor** - Cross-platform mobile

## Quick Start

### 1. Prerequisites
- Docker & Docker Compose installed
- Node.js 20+
- npm or yarn

### 2. Setup

```bash
# Install dependencies
npm install

# Start development environment (Windows PowerShell)
.\setup.ps1

# Or use Docker Compose directly
docker-compose up -d
```

### 3. Access Services

- **App**: http://localhost:3000
- **Hasura Console**: http://localhost:8080
- **Database**: localhost:5432

### 4. Verify Setup

Test the GraphQL API:
```bash
curl -X POST http://localhost:8080/v1/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ companies { id name } }"}'
```

## 📚 Documentation

**Start Here** →
- [README_NEW.md](README_NEW.md) - Complete overview of new architecture
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Quick comparison: Supabase vs Hasura

**Detailed Guides** →
- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) - Phase-by-phase migration instructions
- [HASURA_SETUP.md](HASURA_SETUP.md) - Hasura configuration & GraphQL API
- [COMPONENT_MIGRATION.md](COMPONENT_MIGRATION.md) - How to convert components
- [COOLIFY_DEPLOYMENT.md](COOLIFY_DEPLOYMENT.md) - Production deployment guide
- [MIGRATION_CHECKLIST.md](MIGRATION_CHECKLIST.md) - Comprehensive progress tracking

## 🏗️ Architecture

```
User → Next.js (Frontend) → Hasura (GraphQL API) → PostgreSQL (Database)
        ↓ (Mobile via Capacitor)
      Same GraphQL API
```

All wrapped in Docker containers, deployable to Coolify or any Docker host.

## 📁 Key Directories

- `src/app/` - Next.js pages and components
- `src/lib/hasura/` - GraphQL client and queries
- `supabase/migrations/` - Database schema (PostgreSQL)
- `docker-compose.yml` - Local development setup
- `Dockerfile.next` - Next.js production container
- `Dockerfile.postgres` - PostgreSQL custom image

## 🔄 Migration Status

- ✅ Infrastructure setup (Docker, Hasura, PostgreSQL)
- ✅ GraphQL client library created
- ✅ Core pages migrated (Dashboard, Admin)
- ✅ Comprehensive documentation
- 🔄 **NEXT**: Convert remaining pages to GraphQL
- 🔄 Implement proper authentication
- 🔄 Production deployment to Coolify

See [MIGRATION_CHECKLIST.md](MIGRATION_CHECKLIST.md) for detailed progress.

## 🚀 Getting Started

### New to Hasura/GraphQL?
1. Read [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
2. Open Hasura console at http://localhost:8080
3. Try a query in the GraphiQL editor
4. See [HASURA_SETUP.md](HASURA_SETUP.md) for details

### Converting Components?
1. See [COMPONENT_MIGRATION.md](COMPONENT_MIGRATION.md) for examples
2. All queries are in `src/lib/hasura/queries.ts`
3. Use `hasuraQuery()` for server-side, `useQuery()` for client-side
4. Test queries in Hasura console first

### Deploying to Production?
See [COOLIFY_DEPLOYMENT.md](COOLIFY_DEPLOYMENT.md)

## 📋 Typical Workflow

```bash
# Start development
docker-compose up -d

# Make code changes
# (automatically reloads)

# Test in Hasura console
# http://localhost:8080

# Commit changes
git add .
git commit -m "Convert page to GraphQL"

# Push to GitHub
git push

# Coolify auto-deploys
```

## 🛠️ Common Commands

```bash
# View running containers
docker-compose ps

# View logs
docker-compose logs -f hasura

# Access database
docker-compose exec postgres psql -U warecore warecore

# Stop all containers
docker-compose down

# Fresh start (delete all data)
docker-compose down -v && docker-compose up -d

# View development logs
npm run dev
```

## 📊 What's New

### From Supabase
```typescript
// ❌ Old
const { data } = await supabase.from('companies').select('*')

// ✅ New
const result = await hasuraQuery(COMPANIES_QUERY)
```

### Benefits
- 📈 **GraphQL API** - Type-safe, efficient queries
- 🏢 **Self-hosted** - No vendor lock-in
- 💰 **Cost-effective** - Run on $5/month VPS
- 🚀 **Scalable** - Easy to scale components independently
- 📚 **Better docs** - GraphQL ecosystem is mature
- 🔐 **More control** - Full access to infrastructure

## 🧪 Testing

```bash
# Run linter
npm run lint

# Build for production
npm run build

# Start production server
npm start
```

## 📱 Mobile (Capacitor)

The mobile app connects to the same GraphQL API:

```typescript
const response = await fetch(process.env.NEXT_PUBLIC_HASURA_URL, {
  method: 'POST',
  body: JSON.stringify({ query: COMPANIES_QUERY }),
})
```

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Test locally
4. Push to GitHub
5. Create a Pull Request

## 📞 Support

- **Hasura Docs**: https://hasura.io/docs
- **Next.js Docs**: https://nextjs.org/docs
- **PostgreSQL Docs**: https://www.postgresql.org/docs
- **GraphQL Guide**: https://graphql.org/learn

## 📈 Next Steps

1. Read [QUICK_REFERENCE.md](QUICK_REFERENCE.md) (5 min read)
2. Follow [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) Phase 1 (setup)
3. Start converting pages using [COMPONENT_MIGRATION.md](COMPONENT_MIGRATION.md)
4. Use [MIGRATION_CHECKLIST.md](MIGRATION_CHECKLIST.md) to track progress
5. Deploy to production using [COOLIFY_DEPLOYMENT.md](COOLIFY_DEPLOYMENT.md)

---

**Architecture Migration Version**: 1.0.0  
**Last Updated**: 2026-04-20  
**Status**: 🟡 In Progress (Setup & Core Complete, Pages Migrating)
