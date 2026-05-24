# Backup System - Implementation Guide

## Overview

This guide walks you through implementing and testing the WareCore backup system step-by-step.

**Estimated time:** 30-45 minutes for full setup and testing

## Prerequisites

- Supabase project with WareCore database
- Node.js and npm installed
- WareCore application running
- Admin access to Supabase

## Implementation Steps

### Step 1: Prepare Your Environment (5 minutes)

#### 1.1 Verify Supabase Connection
```bash
# Check your environment variables
cat .env.local | grep SUPABASE

# You should see:
# NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
```

If missing, add them:
```bash
# Get from Supabase dashboard → Settings → API
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

#### 1.2 Verify Supabase Client Installation
```bash
npm list @supabase/supabase-js

# If not installed:
npm install @supabase/supabase-js
```

### Step 2: Apply Database Migration (5 minutes)

#### 2.1 Open Supabase SQL Editor
1. Go to [supabase.com](https://supabase.com)
2. Select your project
3. Navigate to SQL Editor (left sidebar)
4. Click "New Query"

#### 2.2 Copy and Run Migration
1. Open `supabase/migrations/006_backup_system.sql` in your editor
2. Copy entire content
3. Paste into Supabase SQL Editor
4. Click "Run" button
5. Wait for confirmation

**Expected output:**
```
Query executed successfully
Table created: backup_history
Table created: backup_logs
Functions created
RLS policies enabled
```

#### 2.3 Verify Tables Created
```sql
-- Run in Supabase SQL Editor
SELECT * FROM backup_history LIMIT 1;
SELECT * FROM backup_logs LIMIT 1;
```

Should return empty result sets (tables exist but are empty).

### Step 3: Verify Code Files (5 minutes)

All files should be in place:

```bash
# Check service layer
ls -la src/lib/backup/
# Should show: backup.service.ts, backup.client.ts

# Check API routes
ls -la src/app/api/backup/
# Should show: create, metadata, restore, export directories

# Check components
ls -la src/components/ | grep Backup
# Should show: BackupManager.tsx

# Check pages
ls -la src/app/\(app\)/admin/ | grep backup
# Should show: backups directory
```

### Step 4: Start the Application (5 minutes)

#### 4.1 Install Dependencies
```bash
npm install
```

#### 4.2 Start Development Server
```bash
npm run dev
```

#### 4.3 Verify Application Running
```bash
# Open browser
http://localhost:3000

# You should see WareCore application loading
```

### Step 5: Test the Backup UI (10 minutes)

#### 5.1 Navigate to Backup Manager
1. Open http://localhost:3000/admin/backups
2. You should see the Backup Manager interface
3. Three tabs visible: "Create Backup", "Restore", "Export Data"

#### 5.2 Create Your First Backup

**Test: Create Full Database Backup**

1. Click "Create Backup" tab
2. Enter backup name: `"Test Backup 1"`
3. Add note: `"Initial test backup"`
4. Click "Select All" button
5. Verify all tables are checked (16 total)
6. Click "Create & Download Backup" button
7. Wait for completion message
8. Check file download (should be `backup_Test Backup 1.json`)

**Expected result:**
- Green success message appears
- JSON file downloads
- File contains backup metadata and data

#### 5.3 Verify Backup File
1. Open downloaded JSON file in text editor
2. Check structure:
```json
{
  "backup": {
    "id": "uuid",
    "name": "Test Backup 1",
    "timestamp": "2024-...",
    "tables": ["companies", "warehouses", ...],
    "totalRows": 123,
    "createdBy": "your@email.com"
  },
  "data": {
    "companies": [...],
    "warehouses": [...]
  }
}
```

#### 5.4 Verify Backup in History
1. Click "Restore" tab
2. Check if "Test Backup 1" appears in the list
3. Verify timestamp, creator, and row count match

### Step 6: Test CSV Export (5 minutes)

**Test: Export Single Table**

1. Click "Export Data" tab
2. In "Export Single Table" section, click "Export companies"
3. CSV file should download: `companies_2024-01-15T...csv`
4. Open in Excel/Sheets to verify format

**Test: Export Multiple Tables**

1. Click "Export Data" tab
2. In "Export Multiple Tables":
   - Verify some tables are selected
   - Click "Select All"
   - Click "Export 16 Tables as CSV"
3. File downloads: `backup_all_tables_2024-01-15T...csv`
4. Open to verify all tables are included

### Step 7: Test Point-in-Time Features (5 minutes)

**Test: Point-in-Time Export**

1. Click "Export Data" tab
2. In "Point-in-Time" field, enter: `2024-01-01`
3. Click "Export companies"
4. CSV should download with historical data (records created before Jan 1)

**Test: Historical Data Inspection**

1. In "Point-in-Time" field, enter current date: `2024-01-15`
2. Click "Export suppliers"
3. CSV should include recent records

### Step 8: Test Partial Backup (5 minutes)

**Test: Backup Only Master Data**

1. Click "Create Backup" tab
2. Click "Deselect All"
3. Manually select only:
   - companies
   - warehouses
   - suppliers
   - customers
   - material_types
   - material_sizes
4. Name it: "Master Data Only"
5. Click "Create & Download Backup"
6. Verify only 6 tables in backup

### Step 9: Verify Database Records (5 minutes)

#### 9.1 Check Backup Metadata Stored
```sql
-- Run in Supabase SQL Editor
SELECT id, name, timestamp, total_rows, created_by 
FROM backup_history 
ORDER BY timestamp DESC 
LIMIT 5;
```

Should show:
- "Test Backup 1"
- "Master Data Only"
- Other backups you created

#### 9.2 Check Audit Logs
```sql
SELECT action, status, user_email, created_at 
FROM backup_logs 
ORDER BY created_at DESC 
LIMIT 10;
```

Should show backup operations.

### Step 10: Test Restore Capability (5 minutes)

#### 10.1 Prepare Restore Test
1. Download one of your backups from "Restore" tab
2. Note the backup ID and contents

#### 10.2 Verify Restore API Works
```bash
# Test via API (you can skip manual restore for safety)
curl -X POST http://localhost:3000/api/backup/restore \
  -H "Content-Type: application/json" \
  -d '{
    "backupData": { "companies": [] },
    "tables": ["companies"],
    "truncateFirst": false
  }'
```

Should return success message.

### Step 11: Configuration (5 minutes)

#### 11.1 Add Navigation Link

Edit your navigation component to include backup link:

```tsx
// In your navigation/menu component
<Link href="/admin/backups" className="...">
  <Icon />
  Backup & Restore
</Link>
```

#### 11.2 Set Up Retention Policy

Add to your documentation:
```
Backup Retention Policy:
- Daily backups: Keep 7 days
- Weekly backups: Keep 4 weeks
- Monthly backups: Keep 12 months
- Before major changes: Keep indefinitely (with note)
```

### Step 12: Optional - Set Up Automated Backups (10 minutes)

Choose one approach:

#### Option A: Simple Node Cron Job

Create `lib/backup/schedule.ts`:

```typescript
import cron from 'node-cron'
import { createAndDownloadBackup } from './backup.client'

export function scheduleBackups() {
  // Daily at 2 AM
  cron.schedule('0 2 * * *', async () => {
    const today = new Date().toISOString().split('T')[0]
    try {
      await createAndDownloadBackup(undefined, `Daily_${today}`)
      console.log('✓ Daily backup completed')
    } catch (error) {
      console.error('✗ Daily backup failed:', error)
    }
  })

  console.log('✓ Backup schedules configured')
}

// Call in app initialization
if (process.env.ENABLE_AUTO_BACKUPS === 'true') {
  scheduleBackups()
}
```

Add to `.env.local`:
```
ENABLE_AUTO_BACKUPS=true
```

#### Option B: Vercel Cron (Recommended for Vercel)

Create `src/app/api/cron/daily-backup.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAndDownloadBackup } from '@/lib/backup/backup.client'

export async function GET(request: NextRequest) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const today = new Date().toISOString().split('T')[0]
    await createAndDownloadBackup(undefined, `Daily_${today}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
```

Update `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/daily-backup",
    "schedule": "0 2 * * *"
  }]
}
```

### Step 13: Documentation Review (5 minutes)

Review the documentation provided:

1. **BACKUP_SYSTEM.md** - Complete API reference and architecture
2. **BACKUP_QUICK_START.md** - Common use cases and examples
3. **BACKUP_SQL_REFERENCE.md** - Direct SQL operations
4. **BACKUP_SYSTEM_IMPLEMENTATION_CHECKLIST.md** - This file

### Step 14: User Training (Optional)

Share with team:

1. How to create backups
2. How to export data to CSV
3. How to view backup history
4. Point-in-time data retrieval
5. Recovery procedures

## Testing Checklist

Use this checklist to verify everything works:

- [ ] Database migration applied successfully
- [ ] Backup UI accessible at `/admin/backups`
- [ ] Can create backup of all tables
- [ ] Can create backup of selected tables
- [ ] Backup downloads as JSON file
- [ ] Backup appears in metadata list
- [ ] Can export single table to CSV
- [ ] Can export multiple tables to CSV
- [ ] CSV files open correctly in spreadsheet
- [ ] Point-in-time export returns historical data
- [ ] Backup metadata saved in database
- [ ] Audit logs record operations
- [ ] Can delete backup record
- [ ] Error messages display correctly
- [ ] Navigation link works (if added)

## Troubleshooting

### Issue: "Unauthorized" when accessing `/admin/backups`
**Solution:** Ensure you're logged in with an authenticated session

### Issue: Empty backup created
**Solution:** Check database has data, verify Supabase connection

### Issue: CSV export doesn't work
**Solution:** Check browser console for errors, verify table name is correct

### Issue: "Cannot find backup_history table"
**Solution:** Run the database migration again, verify all SQL executed successfully

### Issue: Restore fails with foreign key errors
**Solution:** Restore tables in dependency order, or use `truncateFirst: true`

### Issue: Point-in-time doesn't return data
**Solution:** Use date further in the past, verify records have `created_at` field

## Next Steps After Implementation

1. **Set Up Retention Policy**
   - Define how long to keep backups
   - Document archival procedures
   - Schedule cleanup tasks

2. **Configure Automated Backups**
   - Set up daily/weekly schedules
   - Test scheduled backups run
   - Monitor backup status

3. **Create Disaster Recovery Plan**
   - Document restore procedures
   - Test restore in staging environment
   - Train team on recovery process

4. **Set Up Monitoring**
   - Monitor backup frequency
   - Alert if backup fails
   - Review audit logs weekly

5. **Regular Testing**
   - Test restore quarterly
   - Verify backup integrity
   - Update recovery documentation

## Performance Notes

- **Backup Time:** 5-30 seconds depending on data volume
- **CSV Export:** 2-10 seconds per table
- **Restore Time:** 10-60 seconds depending on data volume
- **Maximum Timeout:** 60 seconds (API limit)

For larger backups:
- Use selective backups (specific tables)
- Backup during off-peak hours
- Consider compression for storage

## Security Notes

1. All backup operations require authentication
2. Backups contain all database data - store securely
3. Use service role key only on backend
4. Implement RLS policies for backup access
5. Encrypt backups at rest
6. Audit all backup operations

## Support & Resources

- **API Documentation:** See `BACKUP_SYSTEM.md`
- **Common Tasks:** See `BACKUP_QUICK_START.md`
- **SQL Operations:** See `BACKUP_SQL_REFERENCE.md`
- **Implementation Details:** See `BACKUP_SYSTEM_IMPLEMENTATION_CHECKLIST.md`

## Completion

Once all steps are complete:

✅ Backup system is fully functional
✅ Users can create backups
✅ Data can be exported to CSV
✅ Point-in-time restore is available
✅ Audit trail is active
✅ Documentation is complete

You're ready for production use!
