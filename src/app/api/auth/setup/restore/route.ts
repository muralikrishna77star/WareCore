import { NextRequest, NextResponse } from 'next/server'
import { hasuraFetchEnvelope } from '@/lib/hasura/transport'
import { restoreFromBackup, type BackupData } from '@/lib/backup/backup.service'

const COUNT_USERS_QUERY = `
  query CountUsers {
    user_profiles_aggregate {
      aggregate { count }
    }
  }
`

/**
 * Restores a previously-exported backup JSON (same shape the Backup Manager
 * produces) onto a brand-new database — only works while user_profiles is
 * empty, same guard as /api/auth/setup. Lets a desktop install pick up an
 * existing online account/data instead of creating a fresh admin.
 */
export async function POST(request: NextRequest) {
  const countJson = await hasuraFetchEnvelope(COUNT_USERS_QUERY)
  const count = countJson?.data?.user_profiles_aggregate?.aggregate?.count ?? 0
  if (count > 0) {
    return NextResponse.json({ error: 'Setup has already been completed' }, { status: 403 })
  }

  let body: { backupData?: { backup?: unknown; data?: BackupData } }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const data = body.backupData?.data
  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Invalid backup file' }, { status: 400 })
  }

  const restoredUserCount = data['user_profiles']?.length ?? 0
  if (restoredUserCount === 0) {
    return NextResponse.json(
      { error: 'Backup file did not include any user accounts (user_profiles). Restore aborted to avoid lockout.' },
      { status: 400 }
    )
  }

  const result = await restoreFromBackup(data, {
    tables: Object.keys(data),
    truncateFirst: false,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, restored: result.restored })
}
