import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { createBackup, saveBackupMetadata } from '@/lib/backup/backup.service'

export const maxDuration = 60 // Allow up to 60 seconds for backup creation

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await verifySessionCookie(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { tables, name, notes } = body

    // Create backup
    const { filename, metadata, backupData } = await createBackup(
      tables || undefined,
      name
    )

    // Update metadata with user info and notes
    metadata.createdBy = session.user?.email || 'unknown'
    if (notes) {
      metadata.notes = notes
    }

    // Save metadata to database
    await saveBackupMetadata(metadata)

    return NextResponse.json({
      success: true,
      backup: {
        id: metadata.id,
        name: metadata.name,
        timestamp: metadata.timestamp,
        tables: metadata.tables,
        totalRows: metadata.totalRows,
        createdBy: metadata.createdBy,
        notes: metadata.notes,
      },
      data: backupData, // Return the actual data for download
    })
  } catch (error) {
    console.error('Error in POST /api/backup/create:', error)
    return NextResponse.json(
      { error: 'Failed to create backup', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
