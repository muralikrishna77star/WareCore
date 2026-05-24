import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { restoreFromBackup, getAllTableData, getPointInTimeBackup } from '@/lib/backup/backup.service'

export const maxDuration = 60 // Allow up to 60 seconds for restore

export async function POST(request: NextRequest) {
  try {
    // Verify authentication (admin only)
    const session = await verifySessionCookie(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { backupData, tables, truncateFirst, pointInTime } = body

    if (!backupData) {
      return NextResponse.json(
        { error: 'Backup data is required' },
        { status: 400 }
      )
    }

    // If point-in-time restore is requested, fetch data as of that time
    let dataToRestore = backupData
    if (pointInTime) {
      dataToRestore = await getPointInTimeBackup(pointInTime, tables)
    }

    // Restore the data
    const result = await restoreFromBackup(dataToRestore, {
      tables,
      truncateFirst: truncateFirst || false,
    })

    return NextResponse.json({
      success: result.success,
      message: result.message,
      restored: result.restored,
    })
  } catch (error) {
    console.error('Error in POST /api/backup/restore:', error)
    return NextResponse.json(
      { error: 'Failed to restore backup', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
