# Hasura Setup & Configuration Guide

## What is Hasura?

Hasura is a GraphQL engine that automatically generates GraphQL APIs from your PostgreSQL database. It provides:
- **Instant GraphQL API** - Automatically generate GraphQL from database tables
- **Real-time subscriptions** - Subscribe to data changes
- **Authorization & RLS** - Row-level security through database policies
- **Event triggers** - Trigger webhooks on database events
- **Custom resolvers** - Add custom business logic

## Initial Setup

### 1. Access the Hasura Console

After starting the Docker containers, open:
```
http://localhost:8080
```

The first time you access it, there's no authentication. For production, set `HASURA_GRAPHQL_ADMIN_SECRET`.

### 2. Connect to Your Database

Hasura automatically connects to the PostgreSQL database specified in `docker-compose.yml`:
- **Host**: postgres (Docker internal)
- **Port**: 5432
- **Database**: warecore
- **User**: warecore
- **Password**: warecore_password_dev

This connection is automatically configured in the docker-compose setup.

### 3. Track Tables

All tables from `supabase/migrations/001_initial_schema.sql` will be automatically created. To expose them as GraphQL:

1. Go to **Data** tab → **SQL Editor**
2. View all tables that have been created
3. Hasura will auto-track them

**Tables tracked:**
- companies
- warehouses
- suppliers
- customers
- users
- materials
- material_types
- material_sizes
- purchase_bills
- purchase_bill_items
- transfers
- dispatch_orders
- job_work_orders
- And more...

### 4. Create Views for Aggregations

Some queries in the app use custom views. These are defined in the migration:

```sql
-- Example: v_current_stock view
CREATE VIEW v_current_stock AS
SELECT 
  w.company_id,
  c.name as company_name,
  c.code as company_code,
  SUM(COALESCE(pbs.current_stock, 0)) as current_stock
FROM warehouses w
JOIN companies c ON w.company_id = c.id
LEFT JOIN purchase_bill_stock pbs ON w.id = pbs.warehouse_id
GROUP BY w.company_id, c.name, c.code;
```

These views will appear in the GraphQL schema automatically.

## Configuring Permissions

### Default Development Setup

For local development, all queries use the admin secret:
```env
HASURA_ADMIN_SECRET=warecore_admin_secret_dev
```

This bypasses all permission checks. Perfect for testing.

### Production Setup (Coming Soon)

For production, implement proper authorization:

```yaml
# Example: Only allow users to see their company's data
companies:
  select:
    permission:
      columns: ["id", "name", "code", "address"]
      filter:
        _or:
          - id: X-User-Company-Id  # Match user's company
          - role: ["admin"]          # OR user is admin
```

## Common GraphQL Operations

### Simple Query
```graphql
query GetCompanies {
  companies(order_by: {name: asc}, limit: 10) {
    id
    name
    code
    is_active
  }
}
```

### Query with Relations
```graphql
query GetWarehouses {
  warehouses(order_by: {name: asc}) {
    id
    name
    companies {
      id
      name
    }
  }
}
```

### Query with Aggregation
```graphql
query CountCompanies {
  companies_aggregate {
    aggregate {
      count
    }
  }
}
```

### Mutation - Insert
```graphql
mutation CreateCompany {
  insert_companies_one(object: {
    name: "ACME Corp"
    code: "ACME"
    is_active: true
  }) {
    id
    name
  }
}
```

### Mutation - Update
```graphql
mutation UpdateCompany {
  update_companies_by_pk(
    pk_columns: {id: "123"}
    _set: {name: "New Name"}
  ) {
    id
    name
  }
}
```

### Mutation - Delete
```graphql
mutation DeleteCompany {
  delete_companies_by_pk(id: "123") {
    id
    name
  }
}
```

## Testing with GraphiQL

The Hasura Console has a built-in GraphQL IDE:

1. Open http://localhost:8080
2. Click **API** tab
3. Write and test queries

## Relationships

Hasura automatically detects foreign key relationships:

```sql
-- Foreign key example
CREATE TABLE warehouses (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id)
);
```

This automatically creates a relationship in GraphQL:
```graphql
warehouses {
  name
  companies {  # Automatic relationship
    name
  }
}
```

## Real-time Subscriptions

For client-side real-time updates:

```graphql
subscription OnCompanyCreated {
  companies(order_by: {created_at: desc}, limit: 1) {
    id
    name
    created_at
  }
}
```

## Event Triggers

Hasura can trigger webhooks when data changes:

1. Go to **Events** tab
2. Create new event trigger
3. Select table and operation (INSERT/UPDATE/DELETE)
4. Add webhook URL

Example use case:
- When a purchase bill is created
- Call webhook to update inventory
- Or send notification

## Custom SQL Queries

Sometimes you need custom SQL logic:

1. Create a view in PostgreSQL
2. Hasura automatically exposes it as a query

Example:
```sql
CREATE VIEW stock_summary AS
SELECT 
  company_id,
  SUM(quantity) as total_stock
FROM current_stock
GROUP BY company_id;
```

Then query it:
```graphql
query {
  stock_summary {
    company_id
    total_stock
  }
}
```

## Troubleshooting

### Table not appearing in GraphQL
```
Data → SQL Editor → Look for table
If it exists but doesn't show in API:
  1. Go to "Track All" or manually track the table
  2. Refresh the page
```

### Query returns null or empty
```
1. Verify data exists in PostgreSQL
2. Check permissions in Hasura (if using them)
3. Use GraphiQL to test query syntax
4. Check for typos in field names
```

### Mutation fails with permission error
```
Make sure request includes:
  - x-hasura-admin-secret header (development)
  - Valid JWT token (production)
```

### Views not showing up
```
Views must be explicitly tracked:
  1. Data → SQL Editor
  2. Find your view
  3. Click "Track" button
```

## Best Practices

1. **Always use `order_by`** in queries for consistent results
2. **Use `limit`** when fetching lists to prevent large payloads
3. **Only select needed fields** to reduce bandwidth
4. **Use variables** in GraphQL for type safety
5. **Test in GraphiQL** before adding to code
6. **Use relationships** instead of separate queries
7. **Cache results** in Next.js to reduce API calls
8. **Monitor performance** using Hasura's built-in tools

## Next Steps

1. Track all database tables in Hasura
2. Test GraphQL queries in GraphiQL
3. Implement authentication/authorization
4. Set up event triggers (optional)
5. Configure real-time subscriptions (optional)
6. Deploy to production

## Resources

- Hasura Docs: https://hasura.io/docs/latest/index/
- GraphQL Tutorial: https://graphql.org/learn/
- PostgreSQL Docs: https://www.postgresql.org/docs/
