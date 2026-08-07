'use client'

import { useEffect, useState } from 'react'
import { hasuraFetch } from '@/lib/hasura/fetcher'
import { DASHBOARD_STATS_QUERY, RECENT_MOVEMENTS_QUERY } from '@/lib/hasura/queries'

export type MovementRow = {
  id: string
  entry_type: string
  quantity: number
  entry_date: string
  reference_number: string | null
  reference_type: string | null
  reference_id: string | null
  size_label: string | null
  companies: { name: string } | null
  warehouses: { name: string } | null
  material_types: { description: string; unit: string } | null
}

export type DashboardData = {
  totalStock: number
  totalBills: number
  pendingTransfers: number
  pendingJobWork: number
  totalDispatches: number
  companyStock: { id: string; name: string; code: string; stock: number }[]
  movements: MovementRow[]
}

type StatsResult = {
  v_current_stock?: { company_id: string; company_name: string; company_code: string; current_stock: number }[]
  purchase_bills_aggregate?: { aggregate?: { count?: number } }
  transfers_aggregate?: { aggregate?: { count?: number } }
  job_work_orders_aggregate?: { aggregate?: { count?: number } }
  dispatch_orders_aggregate?: { aggregate?: { count?: number } }
}

type MovementsResult = { stock_ledger?: MovementRow[] }

/**
 * Client-side counterpart to the server-fetched Existing dashboard's getDashboardStats().
 * Reuses the same two GraphQL queries via the browser-safe hasuraFetch() proxy, so
 * Classic and Modern show real data computed the same way — only fetched lazily,
 * on mount, instead of during the server render.
 */
export function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const [statsRes, movementsRes] = await Promise.all([
        hasuraFetch<StatsResult>(DASHBOARD_STATS_QUERY),
        hasuraFetch<MovementsResult>(RECENT_MOVEMENTS_QUERY),
      ])

      if (cancelled) return

      if (statsRes.error || movementsRes.error) {
        setError(statsRes.error?.message || movementsRes.error?.message || 'Failed to load dashboard data')
        setLoading(false)
        return
      }

      const stockByCompany = statsRes.data?.v_current_stock ?? []
      const totalStock = stockByCompany.reduce((sum, row) => sum + (Number(row.current_stock) || 0), 0)

      const companyStock: Record<string, { id: string; name: string; code: string; stock: number }> = {}
      for (const row of stockByCompany) {
        if (!companyStock[row.company_id]) {
          companyStock[row.company_id] = { id: row.company_id, name: row.company_name, code: row.company_code, stock: 0 }
        }
        companyStock[row.company_id].stock += Number(row.current_stock) || 0
      }

      setData({
        totalStock,
        totalBills: statsRes.data?.purchase_bills_aggregate?.aggregate?.count || 0,
        pendingTransfers: statsRes.data?.transfers_aggregate?.aggregate?.count || 0,
        pendingJobWork: statsRes.data?.job_work_orders_aggregate?.aggregate?.count || 0,
        totalDispatches: statsRes.data?.dispatch_orders_aggregate?.aggregate?.count || 0,
        companyStock: Object.values(companyStock),
        movements: movementsRes.data?.stock_ledger ?? [],
      })
      setLoading(false)
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  return { data, loading, error }
}
