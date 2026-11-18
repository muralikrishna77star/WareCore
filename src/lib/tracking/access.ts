import { getPool } from '@/lib/localdb/pool'
import type { SessionPayload } from '@/lib/auth/session'
import { ALL_COMPANY_ROLES } from './constants'

export interface TrackingActor {
  userId: string
  role: string
  companyId: string | null
  warehouseId: string | null
  allCompanies: boolean
}

/**
 * Role and company come from the user's profile on every request, not from
 * the session cookie, so a deactivated or reassigned user loses access at once.
 */
export async function loadTrackingActor(session: SessionPayload): Promise<TrackingActor | null> {
  const { rows } = await getPool().query(
    `SELECT role, company_id::text AS company_id, warehouse_id::text AS warehouse_id, is_active
       FROM user_profiles WHERE id = $1`,
    [session.userId],
  )
  const profile = rows[0]
  if (!profile || profile.is_active !== 't') return null
  return {
    userId: session.userId,
    role: profile.role,
    companyId: profile.company_id,
    warehouseId: profile.warehouse_id,
    allCompanies: ALL_COMPANY_ROLES.has(profile.role),
  }
}

/** Fails closed: anyone below admin with no company on their profile can reach nothing. */
export function actorCanAccess(actor: TrackingActor, companyId: string, warehouseId: string): boolean {
  if (actor.allCompanies) return true
  if (!actor.companyId || actor.companyId !== companyId) return false
  if (actor.role === 'warehouse_manager' && !actor.warehouseId) return false
  return !actor.warehouseId || actor.warehouseId === warehouseId
}

/** The same rule as actorCanAccess, as SQL. Appends its values to params. */
export function actorScopeSql(actor: TrackingActor, companyColumn: string, warehouseColumn: string, params: unknown[]): string {
  if (actor.allCompanies) return 'TRUE'
  if (!actor.companyId) return 'FALSE'
  if (actor.role === 'warehouse_manager' && !actor.warehouseId) return 'FALSE'
  params.push(actor.companyId)
  let sql = `${companyColumn} = $${params.length}::uuid`
  if (actor.warehouseId) {
    params.push(actor.warehouseId)
    sql += ` AND ${warehouseColumn} = $${params.length}::uuid`
  }
  return sql
}
