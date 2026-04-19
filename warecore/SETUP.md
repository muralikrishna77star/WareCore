# WareCore

A full-stack Warehouse Management System for steel processing businesses.

**Stack**: Next.js 15 + Supabase + Capacitor.js

## Quick Start

```bash
npm install @supabase/ssr @supabase/supabase-js lucide-react clsx tailwind-merge
cp .env.local.example .env.local   # fill in Supabase credentials
# Run SQL migrations in Supabase dashboard
npm run dev
```

## Modules

- Bill Entry — inward purchase recording
- Inventory — real-time stock by company/warehouse/material
- Movements — full stock ledger
- Transfers — inter-company/warehouse
- Job Work — vendor processing with return tracking
- Dispatch — sales with vehicle/driver tracking
- Reports — summary analytics
- Admin — master data management

## Roles

`admin` | `company_manager` | `warehouse_manager` | `sales_manager` | `billing_staff`

See `README.md` for full setup instructions.
