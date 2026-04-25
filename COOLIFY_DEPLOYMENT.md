# Coolify Deployment Guide

## What is Coolify?

Coolify is an open-source, self-hosted platform as a service (PaaS) that makes it easy to deploy applications. It's like Heroku, but you run it on your own servers.

**Key Features:**
- One-click deployments from GitHub
- Automatic Docker container management
- SSL certificates (Let's Encrypt)
- Database backups
- Custom domains
- Scalable infrastructure

## Prerequisites

1. **Coolify Instance** - Self-hosted or cloud
2. **GitHub Account** - For connecting your repository
3. **Docker Host** - Server/machine to deploy on
4. **Domain Name** - For your application

## Installation Options

### Option 1: Self-Hosted on Your Server

```bash
# Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Coolify
curl -fsSL https://get.coollabs.io/docker-compose.yaml | \
  docker-compose -f - up -d
```

Access Coolify at: `http://your-server-ip:3000`

### Option 2: Use Managed Coolify Service

Visit https://coolify.io for managed hosting options.

### Option 3: Deploy on VPS (Recommended)

Popular VPS providers:
- **Linode** - $5/month
- **DigitalOcean** - $5/month  
- **AWS EC2** - $0.0116/hour (t2.micro)
- **Hetzner** - €3/month

## Setup Steps

### Step 1: Connect GitHub Repository

1. Open Coolify dashboard
2. Click **New Project**
3. Select **GitHub**
4. Authorize Coolify with GitHub
5. Select `warecore` repository
6. Click **Create**

### Step 2: Configure Build Settings

1. **Build Command**: `npm ci && npm run build`
2. **Start Command**: `npm start`
3. **Port**: 3000
4. **Node Version**: 20

### Step 3: Add Environment Variables

Add these to Coolify:

```env
# Hasura Configuration
NEXT_PUBLIC_HASURA_URL=https://hasura.yourdomain.com/v1/graphql
HASURA_ADMIN_SECRET=your-production-secret-key

# Database
DATABASE_URL=postgresql://warecore:secure_password@postgres-service:5432/warecore

# Next.js
NODE_ENV=production
NEXT_PUBLIC_APP_NAME=WareCore
```

### Step 4: Deploy PostgreSQL

1. In Coolify, click **Services**
2. Click **Add Service**
3. Select **PostgreSQL**
4. Configure:
   - Database: `warecore`
   - User: `warecore`
   - Password: (generate secure password)
5. Click **Deploy**

### Step 5: Deploy Hasura

1. Click **Add Service**
2. Select **Custom Docker**
3. Use this Docker image: `hasura/graphql-engine:latest`
4. Configure environment variables:
   ```env
   HASURA_GRAPHQL_DATABASE_URL=postgresql://warecore:password@postgres-service:5432/warecore
   HASURA_GRAPHQL_ENABLE_CONSOLE=true
   HASURA_GRAPHQL_ADMIN_SECRET=your-secret
   ```
5. Click **Deploy**

### Step 6: Deploy Next.js Application

1. Click **New Application**
2. Select GitHub repository
3. Configure build settings (see Step 2)
4. Add environment variables (see Step 3)
5. Click **Deploy**

### Step 7: Configure Domains

For each service, add a custom domain:

1. Select service
2. Click **Domains**
3. Add custom domain: `app.yourdomain.com`
4. Let's Encrypt will automatically create SSL cert

**Recommended domains:**
```
app.yourdomain.com          → Next.js
hasura.yourdomain.com       → Hasura Console
postgres.yourdomain.com     → (Keep internal)
```

## Docker Compose for Coolify

If you want to use Docker Compose within Coolify:

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: warecore
      POSTGRES_USER: warecore
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: always
    networks:
      - warecore

  hasura:
    image: hasura/graphql-engine:latest
    depends_on:
      - postgres
    environment:
      HASURA_GRAPHQL_DATABASE_URL: postgresql://warecore:${DB_PASSWORD}@postgres:5432/warecore
      HASURA_GRAPHQL_ENABLE_CONSOLE: 'false'
      HASURA_GRAPHQL_ADMIN_SECRET: ${HASURA_ADMIN_SECRET}
      HASURA_GRAPHQL_JWT_SECRET: ${JWT_SECRET}
    restart: always
    networks:
      - warecore

  next:
    image: ${REGISTRY}/warecore/next:latest
    depends_on:
      - hasura
    environment:
      NEXT_PUBLIC_HASURA_URL: ${NEXT_PUBLIC_HASURA_URL}
      HASURA_ADMIN_SECRET: ${HASURA_ADMIN_SECRET}
      NODE_ENV: production
    restart: always
    networks:
      - warecore

volumes:
  postgres_data:

networks:
  warecore:
    driver: bridge
```

## Continuous Deployment

### Auto-Deploy on Push

Coolify watches your GitHub repository:

1. Push to `main` branch
2. Coolify automatically:
   - Pulls latest code
   - Runs build command
   - Restarts container
   - No downtime (by default)

### Manual Rollback

If deployment fails:

1. Open Coolify dashboard
2. Click application
3. View **Deployments**
4. Click **Rollback** on previous version

## Database Backups

### Automated Backups

Coolify can automatically backup PostgreSQL:

1. In service settings
2. Enable **Backups**
3. Set frequency (daily, weekly)
4. Backups stored on disk

### Manual Backup

```bash
# SSH into your server
ssh user@your-domain.com

# Backup database
docker exec warecore-postgres pg_dump -U warecore warecore > backup.sql

# Restore from backup
docker exec -i warecore-postgres psql -U warecore warecore < backup.sql
```

## Monitoring & Logs

### View Application Logs

In Coolify dashboard:
1. Select application
2. Click **Logs**
3. View real-time logs

### Check Service Health

```bash
# SSH to your server
ssh user@your-domain.com

# Check running containers
docker ps

# View specific service logs
docker logs warecore-next
docker logs warecore-hasura
docker logs warecore-postgres
```

## Performance Optimization

### 1. Database Optimization

```sql
-- Add indexes for common queries
CREATE INDEX idx_companies_code ON companies(code);
CREATE INDEX idx_warehouses_company_id ON warehouses(company_id);
CREATE INDEX idx_purchase_bills_supplier_id ON purchase_bills(supplier_id);
```

### 2. Enable Query Caching

In Hasura:
```env
HASURA_GRAPHQL_QUERY_CACHING_TTL=60  # Cache for 60 seconds
```

### 3. Use Content Delivery Network (CDN)

Add Cloudflare for:
- Cached static assets
- DDoS protection
- Global edge locations

## Scaling

### Horizontal Scaling

As traffic grows:

1. **Increase replicas** - Run multiple Next.js instances behind load balancer
2. **Database connection pooling** - Use PgBouncer
3. **Caching layer** - Add Redis for session/query caching

### Vertical Scaling

Upgrade server resources:
1. More CPU cores
2. More RAM
3. Faster storage (SSD)

## Security

### 1. Environment Variables

Never commit secrets. Store in Coolify:
- Admin secrets
- JWT signing keys
- Database passwords

### 2. SSL/TLS

Let's Encrypt certificates:
- Automatic renewal
- HTTPS only
- Grade A security

### 3. Database Security

```sql
-- Create separate user with limited permissions
CREATE USER app_user WITH PASSWORD 'secure_password';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES 
  IN SCHEMA public TO app_user;
```

### 4. Firewall

Configure firewall rules:
- Allow only necessary ports
- 443 (HTTPS), 80 (HTTP)
- 5432 (PostgreSQL - internal only)

## Troubleshooting

### Application won't start

1. Check logs: `docker logs warecore-next`
2. Verify environment variables are set
3. Ensure build was successful
4. Check Node version matches package.json

### Database connection failed

1. Verify DATABASE_URL is correct
2. Ensure PostgreSQL is running
3. Check firewall allows port 5432
4. Test connection: `psql $DATABASE_URL`

### Hasura console is blank

1. Check Hasura logs: `docker logs warecore-hasura`
2. Verify DATABASE_URL in Hasura env
3. Ensure admin secret is set correctly
4. Clear browser cache

### High latency/slow queries

1. Add database indexes (see Performance section)
2. Check query complexity in GraphQL
3. Reduce batch sizes
4. Use pagination

## Cost Estimation

For a typical warehouse management system:

| Component | VPS Size | Cost/month |
|-----------|----------|-----------|
| Server (2 vCPU, 2GB RAM) | small | $5-10 |
| Database | included | $0 |
| Backups | included | $0 |
| Monitoring | included | $0 |
| **Total** | - | **$5-10** |

*Optional additions:*
- CDN (Cloudflare): $20+
- Managed database: $10-50
- Email service: $10-50

## Next Steps

1. ✅ Set up Coolify on your server
2. ✅ Connect GitHub repository
3. ✅ Deploy PostgreSQL
4. ✅ Deploy Hasura
5. ✅ Deploy Next.js application
6. ✅ Configure custom domains
7. ✅ Set up automatic backups
8. ✅ Monitor and optimize

## Resources

- Coolify Documentation: https://coolify.io/docs
- Docker Documentation: https://docs.docker.com
- PostgreSQL Documentation: https://www.postgresql.org/docs
- Hasura Deployment: https://hasura.io/docs/latest/deployment/
