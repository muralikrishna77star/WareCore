'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { itemLedgerHref, jobWorkReportHref, purchaseLineHref, vendorMovementsHref } from '@/lib/reportLinks'

// Links from an item, purchase line, vendor or job work reference to its
// report. Each falls back to plain text when the id isn't known, and stops
// the click from also triggering a clickable table row underneath.

const DEFAULT_CLASS = 'text-blue-600 hover:underline'

function ReportLink({ href, title, className, children }: { href: string | null; title: string; className?: string; children: ReactNode }) {
  if (!href) return <>{children}</>
  return (
    <Link href={href} title={title} className={className ?? DEFAULT_CLASS} onClick={(e) => e.stopPropagation()}>
      {children}
    </Link>
  )
}

/** Item → Item Stock Ledger (from `fromDate`, else the start of the financial year, to today). */
export function ItemLedgerLink({ itemMasterId, fromDate, className, children }: {
  itemMasterId: string | null | undefined
  fromDate?: string | null
  className?: string
  children: ReactNode
}) {
  return (
    <ReportLink href={itemMasterId ? itemLedgerHref(itemMasterId, fromDate) : null} title="Open this item's Stock Ledger" className={className}>
      {children}
    </ReportLink>
  )
}

/** Purchase line → Purchase Line Movements. Shows the line id when no children are given. */
export function PurchaseLineLink({ lineId, className, children }: {
  lineId: string | null | undefined
  className?: string
  children?: ReactNode
}) {
  return (
    <ReportLink href={lineId ? purchaseLineHref(lineId) : null} title="Open this purchase line's movements" className={className}>
      {children ?? lineId ?? '—'}
    </ReportLink>
  )
}

/** Vendor → Vendorwise Stock Movement (from `fromDate`, else the start of the financial year, to today). */
export function VendorLink({ vendorId, fromDate, className, children }: {
  vendorId: string | null | undefined
  fromDate?: string | null
  className?: string
  children: ReactNode
}) {
  return (
    <ReportLink href={vendorId ? vendorMovementsHref(vendorId, fromDate) : null} title="Open this vendor's stock movement" className={className}>
      {children}
    </ReportLink>
  )
}

/** Job work reference → Job Work Report for that one order. */
export function JobWorkLink({ orderId, className, children }: {
  orderId: string | null | undefined
  className?: string
  children: ReactNode
}) {
  return (
    <ReportLink href={orderId ? jobWorkReportHref(orderId) : null} title="Open this order in the Job Work Report" className={className}>
      {children}
    </ReportLink>
  )
}
