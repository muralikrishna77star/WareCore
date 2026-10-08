'use client'

// A client component on purpose: the report is ~1,600 rows, and a server-
// rendered tree that size is serialized a second time into the RSC payload
// (≈6 MB). Shipping the report data instead keeps the page under 1 MB.
import Link from 'next/link'
import {
  displayRows,
  type BlockTotals,
  type DetailKind,
  type FyTraceabilityReport,
  type LineBlock,
} from '@/lib/fyTraceability'
import { fmtDate, fmtM, fmtQ, monthLabel } from './format'
import { ItemLedgerLink } from '@/components/ReportLinks'

const KIND_STYLE: Partial<Record<DetailKind, string>> = {
  SALE: 'text-gray-900',
  VENDOR_DIRECT_SALE: 'text-amber-800',
  JOB_WORK: 'text-purple-700 italic',
  TRANSFER: 'text-indigo-700 italic',
  PURCHASE_CANCEL: 'text-gray-500 italic',
  PURCHASE_REENTRY: 'text-gray-500 italic',
  OPENING: 'text-teal-700 italic',
  UNSOLD: 'text-gray-400 italic',
  OTHER: 'text-gray-500 italic',
}

const TH = 'px-2 py-1.5 font-semibold text-gray-600 whitespace-nowrap'
// Cell padding and number alignment are set once on the <table> (TABLE_CLS)
// rather than repeated on ~25,000 cells; number cells carry just `n`.
const NUM = 'n'
const TABLE_CLS =
  'w-max min-w-full text-xs [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_td.n]:text-right [&_td.n]:tabular-nums [&_td.n]:whitespace-nowrap'

function Header() {
  return (
    <thead className="sticky top-0 z-10 bg-gray-50 text-[0.6875rem] uppercase">
      <tr className="border-b">
        <th className={`${TH} text-left`}>Purchase Date</th>
        <th className={`${TH} text-left`}>Seller</th>
        <th className={`${TH} text-left`}>Purchase Item Description</th>
        <th className={`${TH} text-left`}>Size</th>
        <th className={`${TH} text-right`}>Purchase Qty</th>
        <th className={`${TH} text-right`}>Rate</th>
        <th className={`${TH} text-right`}>Basic</th>
        <th className={`${TH} text-right`}>Purchase GST</th>
        <th className={`${TH} text-right`}>Purchase Total</th>
        <th className={`${TH} text-left`}>Sales / Remarks</th>
        <th className={`${TH} text-left`}>Sale Date</th>
        <th className={`${TH} text-right`}>Sale Qty</th>
        <th className={`${TH} text-right`}>Balance Qty</th>
        <th className={`${TH} text-right`}>Sale Value</th>
        <th className={`${TH} text-right`} title="Sale value × the GST % on the purchase entry of the line sold">Sale GST</th>
        <th className={`${TH} text-right`}>Stock Value</th>
      </tr>
    </thead>
  )
}

function Block({ block, showJobWork }: { block: LineBlock; showJobWork: boolean }) {
  const rows = displayRows(block, showJobWork)
  const { line } = block
  const negative = block.closingBalance < -0.0005
  // Prior-FY purchases are shown for identification only — never totalled.
  const purchaseCls = block.isPriorFy ? 'text-gray-400' : 'text-gray-900'
  return (
    <tbody className="border-b border-gray-200">
      {rows.map((r, i) => {
        const first = i === 0
        const last = i === rows.length - 1
        return (
          <tr key={i} className={first ? 'border-t border-gray-200' : ''}>
            {first ? (
              <>
                <td className={`whitespace-nowrap ${purchaseCls}`} rowSpan={rows.length}>{fmtDate(line.billDate)}</td>
                <td className={`min-w-[8rem] max-w-[12rem] ${purchaseCls}`} rowSpan={rows.length}>{line.seller}</td>
                <td className="min-w-[11rem] max-w-[16rem]" rowSpan={rows.length}>
                  <div className={purchaseCls}>
                    <ItemLedgerLink itemMasterId={line.itemMasterId} fromDate={line.billDate} className="hover:text-blue-700 hover:underline">
                      {line.description}
                    </ItemLedgerLink>
                  </div>
                  <Link
                    href={`/reports/purchase-line-ledger?line=${encodeURIComponent(line.purchaseLineId)}`}
                    className="font-mono text-[0.6875rem] text-blue-600 hover:underline"
                  >
                    {line.purchaseLineId}
                  </Link>
                  <span className="ml-1 text-[0.6875rem] text-gray-400">Bill {line.billNumber}</span>
                  {block.isPriorFy && (
                    <span className="ml-1 rounded bg-teal-50 px-1 text-[0.625rem] font-medium text-teal-700">Opening Stock / Prior-FY</span>
                  )}
                  {block.unsold && (
                    <span className="ml-1 rounded bg-gray-100 px-1 text-[0.625rem] font-medium text-gray-600">Unsold</span>
                  )}
                </td>
                <td className={`whitespace-nowrap ${purchaseCls}`} rowSpan={rows.length}>{line.size}</td>
                <td className={`${NUM} ${purchaseCls}`} rowSpan={rows.length}>
                  {fmtQ(block.isPriorFy ? line.billedQty : block.purchaseQty)}
                  {block.cancelledQty > 0.0005 && (
                    <div className="text-[0.625rem] text-gray-400">billed {fmtQ(line.billedQty)}</div>
                  )}
                </td>
                <td className={`${NUM} ${purchaseCls}`} rowSpan={rows.length}>{fmtM(line.rate)}</td>
                <td className={`${NUM} ${purchaseCls}`} rowSpan={rows.length}>{fmtM(block.isPriorFy ? line.basic : block.purchaseBasic)}</td>
                <td className={`${NUM} ${purchaseCls}`} rowSpan={rows.length}>{fmtM(block.isPriorFy ? line.gst : block.purchaseGst)}</td>
                <td className={`${NUM} ${purchaseCls}`} rowSpan={rows.length}>{fmtM(block.isPriorFy ? line.total : block.purchaseTotal)}</td>
              </>
            ) : null}
            <td className={`min-w-[16rem] max-w-[26rem] ${KIND_STYLE[r.kind] ?? ''}`}>
              {r.remarks}
              {r.reference && <span className="ml-1 font-mono text-[0.6875rem] text-gray-400">{r.reference}</span>}
            </td>
            <td className={`whitespace-nowrap`}>{fmtDate(r.kind === 'OPENING' ? null : r.date)}</td>
            <td className={NUM}>{r.saleQty != null ? fmtQ(r.saleQty) : ''}</td>
            <td className={`${NUM} ${last ? 'font-semibold' : 'text-gray-500'} ${last && negative ? 'text-red-600' : ''}`}>
              {fmtQ(r.balance)}
              {last && block.closingVendor > 0.0005 && (
                <div className="text-[0.625rem] font-normal text-gray-500">
                  WH {fmtQ(block.closingWarehouse)} · Vendor {fmtQ(block.closingVendor)}
                </div>
              )}
            </td>
            <td className={NUM}>{r.saleValue != null ? fmtM(r.saleValue) : ''}</td>
            <td className={NUM}>{r.saleGst != null ? fmtM(r.saleGst) : ''}</td>
            <td className={`${NUM} ${negative ? 'text-red-600' : ''}`}>{last ? fmtM(block.stockValue) : ''}</td>
          </tr>
        )
      })}
    </tbody>
  )
}

function TotalsRow({ label, totals, tone, priorFy = false }: { label: string; totals: BlockTotals; tone: string; priorFy?: boolean }) {
  return (
    <tbody>
      <tr className={`border-y-2 border-gray-300 font-semibold ${tone}`}>
        <td  colSpan={4}>{label}</td>
        {priorFy ? (
          <td className={`text-right text-[0.6875rem] font-normal text-gray-600`} colSpan={5}>
            Opening balance b/f {fmtQ(totals.openingBalance)} — not in current-year purchases
          </td>
        ) : (
          <>
            <td className={NUM}>{fmtQ(totals.purchaseQty)}</td>
            <td  />
            <td className={NUM}>{fmtM(totals.purchaseBasic)}</td>
            <td className={NUM}>{fmtM(totals.purchaseGst)}</td>
            <td className={NUM}>{fmtM(totals.purchaseTotal)}</td>
          </>
        )}
        <td  colSpan={2} />
        <td className={NUM}>{fmtQ(totals.soldQty)}</td>
        <td className={NUM}>{fmtQ(totals.closingBalance)}</td>
        <td className={NUM}>{fmtM(totals.saleValue)}</td>
        <td className={NUM}>{fmtM(totals.saleGst)}</td>
        <td className={NUM}>{fmtM(totals.stockValue)}</td>
      </tr>
    </tbody>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <tbody>
      <tr className="bg-slate-100">
        <td className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-700" colSpan={16}>{children}</td>
      </tr>
    </tbody>
  )
}

export function FyTraceabilityTable({ report, showJobWork }: { report: FyTraceabilityReport; showJobWork: boolean }) {
  const empty = report.currentFy.length === 0 && report.priorFy.length === 0
  return (
    <div className="rounded-xl border bg-white overflow-hidden">
      <div className="px-4 py-1.5 border-b bg-gray-50 flex justify-between items-center">
        <span className="font-semibold text-gray-700 text-xs">Purchase lines and their sales</span>
        <span className="text-[0.6875rem] text-gray-500">Balance Qty = in warehouse + at job-work vendor</span>
      </div>
      {empty ? (
        <p className="p-8 text-center text-sm text-gray-500">No purchase lines match these filters for the period.</p>
      ) : (
        <div className="overflow-auto max-h-[80vh]">
          <table className={TABLE_CLS}>
            <Header />
            {report.currentFy.map((g) => (
              <PurchaseMonth key={g.month} month={g.month} blocks={g.blocks} totals={g.totals} showJobWork={showJobWork} />
            ))}
            {report.currentFy.length > 0 && (
              <TotalsRow label="Total — purchases this financial year" totals={report.currentFyTotals} tone="bg-blue-50 text-blue-900" />
            )}
            {report.priorFy.length > 0 && (
              <>
                <SectionHeading>Opening Stock / Prior-FY Purchases — sold or held during the period</SectionHeading>
                {report.priorFy.map((b) => (
                  <Block key={b.line.purchaseLineId} block={b} showJobWork={showJobWork} />
                ))}
                <TotalsRow label="Total — Opening Stock / Prior-FY" totals={report.priorFyTotals} tone="bg-teal-50 text-teal-900" priorFy />
              </>
            )}
          </table>
        </div>
      )}
    </div>
  )
}

function PurchaseMonth({ month, blocks, totals, showJobWork }: { month: string; blocks: LineBlock[]; totals: BlockTotals; showJobWork: boolean }) {
  return (
    <>
      <SectionHeading>Purchases — {monthLabel(month)}</SectionHeading>
      {blocks.map((b) => (
        <Block key={b.line.purchaseLineId} block={b} showJobWork={showJobWork} />
      ))}
      <TotalsRow label={`${monthLabel(month)} total`} totals={totals} tone="bg-gray-50 text-gray-800" />
    </>
  )
}
