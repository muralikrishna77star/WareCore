// Location stock counts. Counts are started and scanned from the Offline Scan
// screen (online or not); here they are listed, reviewed and decided. A
// count changes no bundle until a manager decides on a difference.
import { actorCanAccess, actorScopeSql, type TrackingActor } from './access'
import {
  COUNT_DECISIONS_FOR, type CountDecision, type CountOutcome, type StockCountLine, type StockCountSummary,
} from './offlineShared'
import { assertCan, query, requireUuid, TrackingError, type Row } from './service'

const COUNT_COLUMNS = `s.id::text, s.count_no, s.company_id::text, s.warehouse_id::text, c.name AS company_name,
  w.name AS warehouse_name, l.code AS location_code, s.status, s.started_at::text, p.full_name AS started_by_name,
  s.submitted_at::text, s.closed_at::text, s.cancel_reason,
  (SELECT count(*)::int FROM tracking_stock_count_lines x WHERE x.count_id = s.id AND x.scanned_code IS NOT NULL) AS scanned,
  (SELECT count(*)::int FROM tracking_stock_count_lines x WHERE x.count_id = s.id AND x.outcome <> 'FOUND') AS differences,
  (SELECT count(*)::int FROM tracking_stock_count_lines x WHERE x.count_id = s.id AND x.outcome <> 'FOUND' AND x.decision IS NULL) AS undecided`

const COUNT_FROM = `tracking_stock_counts s
  JOIN tracking_locations l ON l.id = s.location_id
  LEFT JOIN companies c ON c.id = s.company_id
  LEFT JOIN warehouses w ON w.id = s.warehouse_id
  LEFT JOIN user_profiles p ON p.id = s.started_by`

function toCount(row: Row): StockCountSummary {
  return { ...row, scanned: Number(row.scanned), differences: Number(row.differences), undecided: Number(row.undecided) } as unknown as StockCountSummary
}

export async function listCounts(actor: TrackingActor, status: unknown): Promise<StockCountSummary[]> {
  const params: unknown[] = []
  const conditions = [actorScopeSql(actor, 's.company_id', 's.warehouse_id', params)]
  if (status === 'OPEN' || status === 'SUBMITTED' || status === 'CLOSED' || status === 'CANCELLED') {
    params.push(status)
    conditions.push(`s.status = $${params.length}`)
  }
  const rows = await query(
    `SELECT ${COUNT_COLUMNS} FROM ${COUNT_FROM} WHERE ${conditions.join(' AND ')}
      ORDER BY (s.status = 'SUBMITTED') DESC, (s.status = 'OPEN') DESC, s.started_at DESC LIMIT 300`,
    params,
  )
  return rows.map(toCount)
}

async function countInScope(actor: TrackingActor, countId: unknown): Promise<StockCountSummary> {
  const rows = await query(`SELECT ${COUNT_COLUMNS} FROM ${COUNT_FROM} WHERE s.id = $1::uuid`, [requireUuid(countId, 'Stock count')])
  const count = rows[0] ? toCount(rows[0]) : null
  if (!count || !actorCanAccess(actor, count.company_id, count.warehouse_id)) throw new TrackingError('Stock count not found', 404)
  return count
}

export async function getCountDetail(actor: TrackingActor, countId: unknown): Promise<{ count: StockCountSummary; lines: StockCountLine[] }> {
  const count = await countInScope(actor, countId)
  const lines = await query(
    `SELECT x.id::text, x.scanned_code, x.tracking_unit_id::text, u.stock_tracking_id, u.item_code, u.item_name, u.size_label,
            u.quantity::text, u.unit, x.scanned_at::text, x.outcome, x.status_at_submit, x.expected_location_code,
            CASE WHEN u.status = 'VOIDED' THEN 'VOIDED' ELSE u.lifecycle_status END AS current_status,
            cl.code AS current_location_code, x.decision, d.full_name AS decided_by_name, x.decided_at::text, x.decision_note
       FROM tracking_stock_count_lines x
       LEFT JOIN tracking_units u ON u.id = x.tracking_unit_id
       LEFT JOIN tracking_locations cl ON cl.id = u.current_location_id
       LEFT JOIN user_profiles d ON d.id = x.decided_by
      WHERE x.count_id = $1::uuid
      ORDER BY CASE x.outcome WHEN 'NOT_FOUND' THEN 0 WHEN 'FOUND_ELSEWHERE' THEN 1 WHEN 'WRONG_STATUS' THEN 2
                              WHEN 'UNKNOWN_LABEL' THEN 3 WHEN 'FOUND' THEN 5 ELSE 4 END,
               x.scanned_at NULLS LAST, u.stock_tracking_id`,
    [count.id],
  )
  return { count, lines: lines as unknown as StockCountLine[] }
}

export async function decideCountLine(actor: TrackingActor, countId: unknown, lineId: unknown, decision: unknown, note: unknown) {
  assertCan(actor, 'manage')
  const count = await countInScope(actor, countId)
  const [line] = await query(
    `SELECT outcome FROM tracking_stock_count_lines WHERE id = $1::uuid AND count_id = $2::uuid`,
    [requireUuid(lineId, 'Count line'), count.id],
  )
  if (!line) throw new TrackingError('Stock count line not found', 404)
  const allowed = COUNT_DECISIONS_FOR[line.outcome as CountOutcome] ?? []
  if (typeof decision !== 'string' || !allowed.includes(decision as CountDecision)) throw new TrackingError('Choose what to do with this difference')
  await query(`SELECT id FROM decide_tracking_count_line($1::uuid, $2, $3, $4::uuid)`, [lineId, decision, typeof note === 'string' ? note : null, actor.userId])
  return getCountDetail(actor, count.id)
}

export async function cancelCount(actor: TrackingActor, countId: unknown, reason: unknown) {
  assertCan(actor, 'operate')
  const count = await countInScope(actor, countId)
  await query(`SELECT id FROM cancel_tracking_stock_count($1::uuid, $2, $3::uuid)`, [count.id, typeof reason === 'string' ? reason : null, actor.userId])
  return getCountDetail(actor, count.id)
}
