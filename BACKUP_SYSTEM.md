# Backup & Restore System Documentation

## Overview

The WareCore Backup & Restore system provides comprehensive data protection with the following features:

- **Full Database Backups**: Create complete snapshots of all or selected tables
- **CSV Export**: Export individual or multiple tables to CSV format for analysis and reporting
- **Point-in-Time Restore**: Restore data as it existed at a specific point in time
- **Backup Management**: Track, view, and manage all backups with metadata
- **Selective Restore**: Restore only specific tables or entire datasets
- **Audit Trail**: Track all backup and restore operations

## Architecture

### Components

1. **Backend Services** (`src/lib/backup/backup.service.ts`)
   - `getAllTableData()` - Fetch all data from specified tables
   - `createBackup()` - Create a backup with metadata
   - `restoreFromBackup()` - Restore data from backup
   - `getPointInTimeBackup()` - Fetch data as of a specific timestamp
   - `dataToCSV()` - Convert data to CSV format

2. **API Endpoints**
   - `POST /api/backup/create` - Create and download backup
   - `GET /api/backup/metadata` - List all backups
   - `DELETE /api/backup/metadata` - Delete backup metadata
   - `POST /api/backup/restore` - Restore from backup
   - `GET/POST /api/backup/export` - Export tables to CSV/JSON

3. **Client Utilities** (`src/lib/backup/backup.client.ts`)
   - `createAndDownloadBackup()` - Create backup and download JSON file
   - `exportTableToCSV()` - Export single table to CSV
   - `exportTablesToCSV()` - Export multiple tables to CSV
   - `restoreBackup()` - Restore data from backup
   - `getBackupsList()` - Fetch list of available backups
   - `deleteBackupById()` - Delete backup record

4. **UI Component** (`src/components/BackupManager.tsx`)
   - Full-featured backup management interface
   - Three tabs: Create Backup, Restore, Export Data
   - Table selection with bulk operations
   - Backup history viewer

5. **Database Objects** (`supabase/migrations/006_backup_system.sql`)
   - `backup_history` table - Backup metadata storage
   - `backup_logs` table - Audit trail
   - `truncate_table()` function - Safely truncate tables
   - `get_table_at_time()` function - Retrieve historical data

## Usage

### Creating a Backup

#### Via UI
1. Navigate to `/admin/backups`
2. Click "Create Backup" tab
3. (Optional) Enter backup name and notes
4. Select tables to backup
5. Click "Create & Download Backup"
6. Save the JSON file

#### Via API
```typescript
const response = await fetch('/api/backup/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tables: ['companies', 'warehouses', 'suppliers'],
    name: 'Monthly Backup',
    notes: 'End of month backup'
  })
})

const { backup, data } = await response.json()
```

#### Via Client Library
```typescript
import { createAndDownloadBackup } from '@/lib/backup/backup.client'

await createAndDownloadBackup(
  ['companies', 'warehouses'],
  'Month End 2024-01',
  'Regular monthly backup'
)
```

### Exporting Data to CSV

#### Single Table
```typescript
import { exportTableToCSV } from '@/lib/backup/backup.client'

// Export current data
await exportTableToCSV('companies')

// Export as of a specific date
await exportTableToCSV('companies', '2024-01-15')
```

#### Multiple Tables
```typescript
import { exportTablesToCSV } from '@/lib/backup/backup.client'

await exportTablesToCSV(
  ['companies', 'warehouses', 'suppliers'],
  '2024-01-15' // optional point-in-time
)
```

#### Via API
```bash
# Export single table as CSV
GET /api/backup/export?table=companies&format=csv

# Export single table as JSON
GET /api/backup/export?table=companies&format=json

# Export with point-in-time
GET /api/backup/export?table=companies&pointInTime=2024-01-15T10:30:00Z

# Export multiple tables
POST /api/backup/export
Content-Type: application/json

{
  "tables": ["companies", "warehouses"],
  "format": "csv",
  "pointInTime": "2024-01-15"
}
```

### Point-in-Time Restore

The system allows you to restore data as it existed at any specific point in time using the `created_at` timestamps.

#### Method 1: Point-in-Time via API
```typescript
const response = await fetch('/api/backup/restore', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    backupData: { /* backup data */ },
    pointInTime: '2024-01-15T10:30:00Z',
    tables: ['companies', 'warehouses'],
    truncateFirst: true
  })
})
```

#### Method 2: Export Historical Data and Restore
```typescript
// 1. Export data as of a specific time
const response = await fetch(
  '/api/backup/export?table=companies&pointInTime=2024-01-15'
)
const csvData = await response.text()

// 2. Use this data for analysis or restore

// 3. Or restore the entire backup
const backupData = await exportTableToJSON('companies', '2024-01-15')
```

### Restoring Data

#### Complete Restore (All Tables)
```typescript
import { restoreBackup } from '@/lib/backup/backup.client'

const backupData = JSON.parse(backupFileContent).data

await restoreBackup(backupData, {
  truncateFirst: true // Clears tables before restore
})
```

#### Selective Table Restore
```typescript
await restoreBackup(backupData, {
  tables: ['companies', 'warehouses'],
  truncateFirst: true
})
```

#### Point-in-Time Restore
```typescript
await restoreBackup(backupData, {
  pointInTime: '2024-01-15T10:30:00Z',
  tables: ['stock_ledger'],
  truncateFirst: true
})
```

### Via UI
1. Navigate to `/admin/backups`
2. Click "Restore" tab
3. View available backups
4. (To restore: export a backup from "Create Backup" tab, then restore using database tools)

## Backup File Format

Backups are saved as JSON files with the following structure:

```json
{
  "backup": {
    "id": "uuid",
    "name": "Monthly Backup",
    "timestamp": "2024-01-15T10:30:00Z",
    "tables": ["companies", "warehouses", ...],
    "totalRows": 1250,
    "createdBy": "user@example.com",
    "notes": "Optional notes"
  },
  "data": {
    "companies": [
      {
        "id": "uuid",
        "name": "Company Name",
        "created_at": "2024-01-01T00:00:00Z",
        ...
      }
    ],
    "warehouses": [
      ...
    ]
  }
}
```

## CSV Export Format

- **Header Row**: Column names quoted and comma-separated
- **Data Rows**: Values properly escaped and quoted
- **Special Handling**:
  - NULL values: Empty strings
  - Strings: Quoted with escaped internal quotes
  - JSON/Objects: Serialized as JSON strings
  - Multiple Tables: Separated by `=== TABLE: tablename ===`

Example:
```csv
"id","name","created_at","is_active"
"550e8400-e29b-41d4-a716-446655440000","Company A","2024-01-01T00:00:00Z",true
"6ba7b810-9dad-11d1-80b4-00c04fd430c8","Company B","2024-01-02T00:00:00Z",false
```

## Database Schema

### backup_history Table
```sql
CREATE TABLE backup_history (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  tables TEXT[] NOT NULL,
  total_rows INTEGER DEFAULT 0,
  backup_path TEXT NOT NULL,
  created_by TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### backup_logs Table
```sql
CREATE TABLE backup_logs (
  id UUID PRIMARY KEY,
  backup_id UUID REFERENCES backup_history(id),
  action TEXT NOT NULL,
  user_email TEXT,
  tables_involved TEXT[],
  status TEXT NOT NULL,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Supported Tables

The backup system supports all WareCore data tables:

1. **Master Data**
   - companies
   - warehouses
   - suppliers
   - customers
   - material_types
   - material_sizes

2. **User Management**
   - user_profiles

3. **Purchase Management**
   - purchase_bills
   - purchase_bill_items

4. **Inventory**
   - stock_ledger

5. **Transfers**
   - transfers
   - transfer_items

6. **Job Work**
   - job_work_orders
   - job_work_items

7. **Dispatch/Sales**
   - dispatch_orders
   - dispatch_items

## Security Considerations

1. **Authentication**: All backup operations require user authentication
2. **Authorization**: Backup metadata operations check user permissions
3. **Data Sensitivity**: Backups contain sensitive business data - store securely
4. **Access Control**: Use Supabase RLS policies to restrict backup access
5. **Encryption**: Consider encrypting backup files at rest
6. **Audit Trail**: All backup operations are logged in backup_logs table

## Performance

- **Backup Creation**: ~5-30 seconds depending on data volume
- **CSV Export**: ~2-10 seconds per table
- **Restore**: ~10-60 seconds depending on data volume
- **Point-in-Time Queries**: Uses indexes on created_at for fast filtering

## Batch Operations

Data is restored in batches of 1000 rows to optimize performance and reduce memory usage.

## Error Handling

All operations include comprehensive error handling:
- Failed operations return detailed error messages
- Partial restores continue with other tables/batches
- Original data is preserved if restore fails
- Audit logs record all failures

## Maintenance

### Regular Cleanup
```typescript
// Delete old backups (example: older than 90 days)
const backups = await getBackupsList()
const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

for (const backup of backups) {
  if (new Date(backup.timestamp) < ninetyDaysAgo) {
    await deleteBackupById(backup.id)
  }
}
```

### Monitor Backup Storage
- Regular backups consume storage space
- Implement retention policies (e.g., keep last 30 days)
- Archive older backups to external storage if needed

## Troubleshooting

### Backup Creation Fails
- Check Supabase connection and authentication
- Verify sufficient database read permissions
- Check available memory and connection timeout

### Restore Fails
- Verify backup file integrity
- Check table constraints and foreign keys
- Ensure sufficient database write permissions
- Try restoring specific tables first

### Point-in-Time Not Working
- Ensure `created_at` timestamps are accurate
- Check if records exist at the specified timestamp
- Use ISO format timestamps (YYYY-MM-DDTHH:mm:ssZ)

### Export Issues
- Verify table names are correct
- Check for special characters in data requiring escaping
- Large tables may need longer timeout values

## API Reference

### POST /api/backup/create
Creates a backup and returns backup data

**Request:**
```json
{
  "tables": ["companies", "warehouses"],
  "name": "Backup Name",
  "notes": "Optional notes"
}
```

**Response:**
```json
{
  "success": true,
  "backup": {
    "id": "uuid",
    "name": "Backup Name",
    "timestamp": "2024-01-15T10:30:00Z",
    "tables": ["companies", "warehouses"],
    "totalRows": 100,
    "createdBy": "user@example.com"
  },
  "data": { /* backup data */ }
}
```

### GET /api/backup/metadata
Lists all backups

**Query Parameters:**
- `id` (optional): Get specific backup by ID

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Backup Name",
    "timestamp": "2024-01-15T10:30:00Z",
    "tables": ["companies", "warehouses"],
    "totalRows": 100,
    "createdBy": "user@example.com",
    "notes": "Optional notes"
  }
]
```

### DELETE /api/backup/metadata
Deletes a backup record

**Query Parameters:**
- `id` (required): Backup ID to delete

**Response:**
```json
{
  "success": true,
  "message": "Backup deleted"
}
```

### POST /api/backup/restore
Restores data from backup

**Request:**
```json
{
  "backupData": { /* data to restore */ },
  "tables": ["companies", "warehouses"],
  "truncateFirst": true,
  "pointInTime": "2024-01-15T10:30:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Restored 1250 records",
  "restored": 1250
}
```

### GET /api/backup/export
Exports a single table

**Query Parameters:**
- `table` (required): Table name to export
- `format` (optional): "csv" or "json" (default: "csv")
- `pointInTime` (optional): ISO timestamp for point-in-time export

**Response:**
- CSV: File download with CSV content
- JSON: JSON object with exported data

### POST /api/backup/export
Exports multiple tables

**Request:**
```json
{
  "tables": ["companies", "warehouses"],
  "format": "csv",
  "pointInTime": "2024-01-15T10:30:00Z"
}
```

**Response:**
- CSV: Combined file with all tables
- JSON: Object with data from all tables

## Best Practices

1. **Regular Backups**: Schedule backups weekly or daily
2. **Off-site Storage**: Keep backups on separate systems
3. **Test Restores**: Periodically test restore procedures
4. **Document Changes**: Note significant data changes in backup notes
5. **Monitor Retention**: Delete old backups based on retention policy
6. **Encrypt Backups**: Store backup files securely
7. **Access Control**: Restrict backup access to authorized users
8. **Audit Review**: Regularly review backup_logs for anomalies

## Support

For issues or feature requests related to the backup system:
1. Check the troubleshooting section
2. Review backup_logs table for error details
3. Verify authentication and permissions
4. Contact system administrator for assistance
