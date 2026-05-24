# Backup System - Quick Start Guide

## 5-Minute Setup

### 1. Run Database Migration
```bash
# Apply the backup system migration to your Supabase database
# Using Supabase SQL Editor:
# Copy content from: supabase/migrations/006_backup_system.sql
# Paste into Supabase SQL Editor
# Click "Run"
```

### 2. Access Backup Interface
- Navigate to: `http://localhost:3000/admin/backups`
- You'll see three tabs:
  - **Create Backup**: Full or partial backup creation
  - **Restore**: View and manage backups
  - **Export Data**: CSV/JSON export options

### 3. Create Your First Backup
1. Click "Create Backup" tab
2. Enter a name: "Initial Backup"
3. Leave notes empty or add optional notes
4. Click "Select All" to backup all tables
5. Click "Create & Download Backup"
6. Save the JSON file to your computer

## Common Tasks

### Task 1: Daily CSV Export of All Data

**Scenario**: You need daily exports of all data for reporting

**Solution**:
```typescript
// Place in a scheduled job or cron task
import { exportTablesToCSV } from '@/lib/backup/backup.client'

const TABLES = [
  'companies', 'warehouses', 'suppliers', 'customers',
  'material_types', 'material_sizes', 'user_profiles',
  'purchase_bills', 'purchase_bill_items', 'stock_ledger',
  'transfers', 'transfer_items', 'job_work_orders',
  'job_work_items', 'dispatch_orders', 'dispatch_items',
]

async function dailyExport() {
  try {
    await exportTablesToCSV(TABLES)
    console.log('Daily export completed successfully')
  } catch (error) {
    console.error('Daily export failed:', error)
    // Send alert to admin
  }
}
```

### Task 2: Weekly Full Database Backup

**Scenario**: You want automated weekly backups stored for 30 days

**Solution**:
```typescript
import { createAndDownloadBackup, getBackupsList, deleteBackupById } from '@/lib/backup/backup.client'

async function weeklyBackup() {
  const today = new Date()
  const weekName = `Weekly_${today.getFullYear()}_Week${Math.ceil((today.getDate() + new Date(today.getFullYear(), 0, 1).getDay()) / 7)}`

  // Create new backup
  await createAndDownloadBackup(undefined, weekName, `Automatic weekly backup`)

  // Clean up backups older than 30 days
  const backups = await getBackupsList()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  for (const backup of backups) {
    if (new Date(backup.timestamp) < thirtyDaysAgo) {
      await deleteBackupById(backup.id)
      console.log(`Deleted old backup: ${backup.name}`)
    }
  }
}

// Schedule with node-cron or similar
// cron.schedule('0 2 * * 0', weeklyBackup) // Every Sunday at 2 AM
```

### Task 3: Export Specific Table for Audit

**Scenario**: Auditor needs all purchase bills from January

**Solution**:
```typescript
import { exportTableToCSV } from '@/lib/backup/backup.client'

// Download all purchase bills
async function auditExport() {
  await exportTableToCSV('purchase_bills')
}

// Or with point-in-time for specific period
async function auditExportPeriod() {
  const startOfJanuary = '2024-01-01'
  const endOfJanuary = '2024-01-31T23:59:59Z'
  
  // Note: This exports records as they existed on the start date
  await exportTableToCSV('purchase_bills', startOfJanuary)
}
```

### Task 4: Restore to Point-in-Time After Accidental Deletion

**Scenario**: 10 records were accidentally deleted from dispatch_orders on Jan 15. Restore them.

**Solution**:
```typescript
import { exportTableToJSON, restoreBackup } from '@/lib/backup/backup.client'

async function restoreDeletedRecords() {
  // 1. Export data as it was before the deletion
  // (e.g., Jan 14 at end of day)
  const historical = await exportTableToJSON(
    'dispatch_orders',
    '2024-01-14T23:59:59Z'
  )

  // 2. Extract just dispatch_orders
  const backupData = {
    dispatch_orders: historical.data
  }

  // 3. Restore (without truncating to preserve newer records)
  await restoreBackup(backupData, {
    tables: ['dispatch_orders'],
    truncateFirst: false // Don't erase current data
  })

  console.log('Deleted records restored successfully')
}
```

### Task 5: Backup Before Major System Changes

**Scenario**: You're about to make significant changes. You want a labeled backup.

**Solution**:
```typescript
import { createAndDownloadBackup } from '@/lib/backup/backup.client'

async function preChangeBackup() {
  const timestamp = new Date().toISOString().split('T')[0]
  
  await createAndDownloadBackup(
    undefined, // all tables
    `Pre-Migration_${timestamp}`,
    `Full backup before inventory system upgrade. Reference: TICKET-1234`
  )

  console.log('Pre-migration backup created')
  // Now proceed with your changes
}
```

### Task 6: Export for Data Migration to Another System

**Scenario**: Migrate companies and customers to a new ERP system

**Solution**:
```typescript
import { exportTableToJSON } from '@/lib/backup/backup.client'

async function exportForMigration() {
  const companies = await exportTableToJSON('companies')
  const customers = await exportTableToJSON('customers')

  // Transform if needed for target system
  const migrationData = {
    companies: companies.data.map(c => ({
      code: c.code,
      name: c.name,
      email: c.email,
      phone: c.phone,
      // ... map other fields as needed
    })),
    customers: customers.data.map(c => ({
      code: c.id, // Generate code if needed
      name: c.name,
      email: c.email,
      // ... map other fields
    }))
  }

  // Export as JSON for manual import
  const json = JSON.stringify(migrationData, null, 2)
  // Download or send to migration tool
}
```

### Task 7: Monthly Compliance Backup

**Scenario**: Keep monthly snapshots for regulatory compliance

**Solution**:
```typescript
import { createAndDownloadBackup } from '@/lib/backup/backup.client'

async function monthlyComplianceBackup() {
  const now = new Date()
  const month = now.toLocaleString('default', { month: 'long' })
  const year = now.getFullYear()

  await createAndDownloadBackup(
    undefined,
    `Compliance_${month}_${year}`,
    `Monthly compliance backup for audit trail. Retained per policy.`
  )

  // Store this backup in secure, off-site location
}

// Schedule: 1st day of each month at 3 AM
// cron.schedule('0 3 1 * *', monthlyComplianceBackup)
```

### Task 8: Selective Backup - Master Data Only

**Scenario**: Backup only master data (companies, materials, suppliers, customers) - not transactional data

**Solution**:
```typescript
import { createAndDownloadBackup } from '@/lib/backup/backup.client'

async function masterDataBackup() {
  const masterDataTables = [
    'companies',
    'warehouses',
    'suppliers',
    'customers',
    'material_types',
    'material_sizes'
  ]

  await createAndDownloadBackup(
    masterDataTables,
    'Master_Data_Backup',
    'Backup of all master/reference data'
  )
}
```

## Scheduling Backups

### Option 1: Node.js Cron Job
```typescript
import cron from 'node-cron'
import { createAndDownloadBackup } from '@/lib/backup/backup.client'

// Daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0]
    await createAndDownloadBackup(undefined, `Daily_${today}`)
  } catch (error) {
    console.error('Backup failed:', error)
  }
})

// Weekly on Sunday at 3 AM
cron.schedule('0 3 * * 0', async () => {
  try {
    const week = Math.ceil((new Date().getDate() + new Date(new Date().getFullYear(), 0, 1).getDay()) / 7)
    await createAndDownloadBackup(undefined, `Weekly_W${week}`)
  } catch (error) {
    console.error('Weekly backup failed:', error)
  }
})
```

### Option 2: Vercel Cron Functions
```typescript
// pages/api/cron/daily-backup.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAndDownloadBackup } from '@/lib/backup/backup.client'

export async function GET(request: NextRequest) {
  // Verify the request is from Vercel
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const today = new Date().toISOString().split('T')[0]
    await createAndDownloadBackup(undefined, `Daily_${today}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/daily-backup",
      "schedule": "0 2 * * *"
    }
  ]
}
```

### Option 3: External Cron Service
- Use cron.io or similar service
- Set up HTTP request to trigger backup API endpoint
- Example: `POST https://your-domain.com/api/backup/create`

## Monitoring Backups

### View Backup History
```typescript
import { getBackupsList } from '@/lib/backup/backup.client'

async function showBackupStatus() {
  const backups = await getBackupsList()
  
  console.log(`Total backups: ${backups.length}`)
  
  for (const backup of backups) {
    const size = backup.totalRows
    const date = new Date(backup.timestamp)
    console.log(`- ${backup.name}: ${size} rows on ${date.toLocaleDateString()}`)
  }

  // Check if recent backup exists
  const now = new Date()
  const lastBackup = backups[0]
  const hoursSinceBackup = (now.getTime() - new Date(lastBackup.timestamp).getTime()) / (1000 * 60 * 60)
  
  if (hoursSinceBackup > 24) {
    console.warn('⚠️ No backup in the last 24 hours!')
    // Send alert
  }
}
```

### Set Up Notifications
```typescript
import { getBackupsList } from '@/lib/backup/backup.client'

async function checkBackupHealth() {
  const backups = await getBackupsList()
  const now = new Date()
  
  // Check for daily backup
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todaysBackup = backups.find(b => 
    new Date(b.timestamp) >= today && 
    new Date(b.timestamp) < new Date(today.getTime() + 24 * 60 * 60 * 1000)
  )

  if (!todaysBackup) {
    // Send email/Slack notification
    await notifyAdmin('No backup created today!')
  }

  // Check storage
  const totalRows = backups.reduce((sum, b) => sum + b.totalRows, 0)
  if (totalRows > 1000000) {
    await notifyAdmin(`High backup storage: ${totalRows.toLocaleString()} rows`)
  }
}
```

## Testing Backups

### Verify Backup Integrity
```typescript
import { createAndDownloadBackup, getBackupsList } from '@/lib/backup/backup.client'

async function verifyBackup() {
  // Create backup
  const response = await fetch('/api/backup/create', {
    method: 'POST',
    body: JSON.stringify({})
  })

  const { backup, data } = await response.json()

  // Verify structure
  console.log(`✓ Backup created: ${backup.name}`)
  console.log(`✓ Tables backed up: ${backup.tables.length}`)
  console.log(`✓ Total rows: ${backup.totalRows}`)

  // Verify each table
  for (const table of backup.tables) {
    const rows = data[table]?.length || 0
    console.log(`  - ${table}: ${rows} rows`)
  }

  // Verify metadata was saved
  const allBackups = await getBackupsList()
  const saved = allBackups.find(b => b.id === backup.id)
  if (saved) {
    console.log('✓ Backup metadata saved successfully')
  }
}
```

## Recovery Procedures

### Full Database Recovery
```bash
# 1. Download latest backup from /admin/backups
# 2. Extract the JSON file
# 3. In Supabase dashboard:
#    a. Go to SQL Editor
#    b. For each table in the backup:
#       - TRUNCATE TABLE table_name CASCADE;
#       - INSERT INTO table_name VALUES (...) [from backup data]
# 4. Or use the API: POST /api/backup/restore
```

### Point-in-Time Recovery
```bash
# 1. Identify the timestamp you want to recover to
# 2. Use: GET /api/backup/export?pointInTime=2024-01-15T10:30:00Z
# 3. Review the data
# 4. Restore using: POST /api/backup/restore with pointInTime parameter
```

## Troubleshooting

### Backup Download Appears Empty
- Check browser console for errors
- Verify database has data
- Check authentication tokens

### Cannot Find Backup History
- Run migration 006_backup_system.sql
- Check backup_history table exists
- Verify user has read permissions

### Restore Seems Slow
- Large tables take time to restore
- Check database connection
- Monitor available resources
- Restore smaller tables first to test

### Point-in-Time Not Returning Data
- Verify timestamp format (ISO 8601)
- Ensure records exist at that timestamp
- Check created_at field has accurate data
- Try a date further in the past

## Next Steps

1. **Set up automated backups** - Schedule daily/weekly backups
2. **Test restore procedures** - Ensure recovery works
3. **Document policies** - Define retention and access rules
4. **Monitor regularly** - Check backup health weekly
5. **Secure backups** - Store securely and encrypt if possible
