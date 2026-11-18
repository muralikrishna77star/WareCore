import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { buildBackupMetadata, readTableForBackup, saveBackupMetadata } from '@/lib/backup/backup.service'
import { BACKUP_TABLES } from '@/lib/backup/tables'

export const maxDuration = 300 // A full backup reads every table in the database

// Full-database export — matches the other backup routes' admin/developer gate.
const ALLOWED_ROLES = new Set(['admin', 'developer'])

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await verifySessionCookie(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!ALLOWED_ROLES.has(session.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const { tables, name, notes } = body

    // Table names end up in SQL, so only names on the backup list are accepted.
    const requested = Array.isArray(tables) ? new Set<string>(tables) : null
    const tablesToBackup = BACKUP_TABLES.filter((table) => !requested || requested.has(table))
    if (tablesToBackup.length === 0) {
      return NextResponse.json({ error: 'No valid tables selected' }, { status: 400 })
    }

    // Streamed, because a full backup is far larger than the 4.5 MB Vercel
    // allows for a normal response. If a table can't be read the stream fails,
    // the browser gets incomplete JSON and no backup file is saved; the history
    // row is only written once every table has been read.
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          let totalRows = 0
          controller.enqueue(encoder.encode('{"data":{'))
          for (const [index, table] of tablesToBackup.entries()) {
            const rows = await readTableForBackup(table)
            totalRows += rows.length
            controller.enqueue(encoder.encode(`${index ? ',' : ''}${JSON.stringify(table)}:${JSON.stringify(rows)}`))
          }

          const metadata = buildBackupMetadata(tablesToBackup, totalRows, name)
          metadata.createdBy = session.email || 'unknown'
          if (notes) {
            metadata.notes = notes
          }
          await saveBackupMetadata(metadata)

          const backup = {
            id: metadata.id,
            name: metadata.name,
            timestamp: metadata.timestamp,
            tables: metadata.tables,
            totalRows: metadata.totalRows,
            createdBy: metadata.createdBy,
            notes: metadata.notes,
          }
          controller.enqueue(encoder.encode(`},"success":true,"backup":${JSON.stringify(backup)}}`))
          controller.close()
        } catch (error) {
          console.error('Error streaming backup:', error)
          controller.error(error)
        }
      },
    })

    return new NextResponse(stream, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('Error in POST /api/backup/create:', error)
    return NextResponse.json(
      { error: 'Failed to create backup', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
