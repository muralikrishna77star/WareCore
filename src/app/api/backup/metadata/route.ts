import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'
import { listBackups, getBackup, deleteBackup } from '@/lib/backup/backup.service'

const ALLOWED_ROLES = new Set(['admin', 'developer'])

export async function GET(request: NextRequest) {
  try {
    // Verify authentication (admin only)
    const session = await verifySessionCookie(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!ALLOWED_ROLES.has(session.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const backupId = searchParams.get('id')

    if (backupId) {
      // Get specific backup
      const backup = await getBackup(backupId)
      if (!backup) {
        return NextResponse.json({ error: 'Backup not found' }, { status: 404 })
      }
      return NextResponse.json(backup)
    }

    // List all backups
    const backups = await listBackups()
    return NextResponse.json(backups)
  } catch (error) {
    console.error('Error in GET /api/backup/metadata:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve backup metadata' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Verify authentication (admin only)
    const session = await verifySessionCookie(request)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!ALLOWED_ROLES.has(session.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const backupId = searchParams.get('id')

    if (!backupId) {
      return NextResponse.json({ error: 'Backup ID required' }, { status: 400 })
    }

    await deleteBackup(backupId)
    return NextResponse.json({ success: true, message: 'Backup deleted' })
  } catch (error) {
    console.error('Error in DELETE /api/backup/metadata:', error)
    return NextResponse.json(
      { error: 'Failed to delete backup metadata' },
      { status: 500 }
    )
  }
}
