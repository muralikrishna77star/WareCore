import type { FyTraceabilityReport, MonthSummaryRow } from '@/lib/fyTraceability'
import { fmtDate, fmtM, fmtQ, monthLabel } from './format'

const TH = 'px-2 py-1.5 font-semibold text-gray-600 whitespace-nowrap text-right'
const NUM = 'px-2 py-1 text-right tabular-nums whitespace-nowrap'

function SummaryRow({ row, label, strong = false }: { row: MonthSummaryRow; label: string; strong?: boolean }) {
  return (
    <tr className={strong ? 'border-t-2 border-gray-300 bg-blue-50 font-semibold text-blue-900' : 'border-t border-gray-100'}>
      <td className="px-2 py-1 whitespace-nowrap">{label}</td>
      <td className={NUM}>{fmtQ(row.openingQty)}</td>
      <td className={NUM}>{fmtQ(row.purchaseQty)}</td>
      <td className={NUM}>{fmtM(row.purchaseBasic)}</td>
      <td className={NUM}>{fmtM(row.purchaseGst)}</td>
      <td className={NUM}>{fmtM(row.purchaseTotal)}</td>
      <td className={`${NUM} border-l`}>{fmtQ(row.saleQty)}</td>
      <td className={NUM}>{fmtM(row.saleValue)}</td>
      <td className={NUM}>{fmtM(row.saleGst)}</td>
      <td className={`${NUM} border-l text-teal-800`}>{fmtQ(row.priorSaleQty)}</td>
      <td className={`${NUM} text-teal-800`}>{fmtM(row.priorSaleValue)}</td>
      <td className={`${NUM} text-teal-800`}>{fmtM(row.priorSaleGst)}</td>
      <td className={`${NUM} border-l text-amber-800`}>{fmtQ(row.unlinkedSaleQty)}</td>
      <td className={`${NUM} text-amber-800`}>{fmtM(row.unlinkedSaleValue)}</td>
      <td className={`${NUM} border-l text-gray-500`}>{fmtQ(row.otherQty)}</td>
      <td className={`${NUM} border-l font-semibold`}>{fmtQ(row.closingQty)}</td>
      <td className={NUM}>{fmtQ(row.closingWarehouse)}</td>
      <td className={NUM}>{fmtQ(row.closingVendor)}</td>
      <td className={`${NUM} font-semibold`}>{fmtM(row.closingValue)}</td>
    </tr>
  )
}

export function FyTraceabilitySummary({ report }: { report: FyTraceabilityReport }) {
  return (
    <div id="monthly-summary" className="rounded-xl border bg-white overflow-hidden">
      <div className="px-4 py-1.5 border-b bg-gray-50 flex justify-between items-center flex-wrap gap-2">
        <span className="font-semibold text-gray-700 text-xs">Monthly summary — {fmtDate(report.fyStart)} to {fmtDate(report.cutoff)}</span>
        <span className="text-[0.6875rem] text-gray-500">
          Sales are counted in the month they were made; closing = warehouse + at vendor, valued at each line&apos;s purchase rate
        </span>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[0.6875rem] uppercase">
            <tr className="border-b text-gray-500">
              <th className="px-2 py-1" />
              <th className="px-2 py-1" />
              <th className="px-2 py-1 text-center" colSpan={4}>Purchases (this FY)</th>
              <th className="px-2 py-1 text-center border-l" colSpan={3}>Sales of this FY&apos;s purchases</th>
              <th className="px-2 py-1 text-center border-l text-teal-700" colSpan={3}>Sales of Opening / Prior-FY stock</th>
              <th className="px-2 py-1 text-center border-l text-amber-700" colSpan={2}>Sales with no purchase line</th>
              <th className="px-2 py-1 border-l" />
              <th className="px-2 py-1 text-center border-l" colSpan={4}>Closing balance</th>
            </tr>
            <tr className="border-b">
              <th className={`${TH} text-left`}>Month</th>
              <th className={TH}>Opening Qty</th>
              <th className={TH}>Qty</th>
              <th className={TH}>Basic</th>
              <th className={TH}>GST</th>
              <th className={TH}>Total</th>
              <th className={`${TH} border-l`}>Qty</th>
              <th className={TH}>Value</th>
              <th className={TH}>GST</th>
              <th className={`${TH} border-l`}>Qty</th>
              <th className={TH}>Value</th>
              <th className={TH}>GST</th>
              <th className={`${TH} border-l`}>Qty</th>
              <th className={TH}>Value</th>
              <th className={`${TH} border-l`} title="Closing − (opening + purchases − linked sales): job-work process loss and adjustments">Loss / Other</th>
              <th className={`${TH} border-l`}>Qty</th>
              <th className={TH}>In Warehouse</th>
              <th className={TH}>At Vendor</th>
              <th className={TH}>Stock Value</th>
            </tr>
          </thead>
          <tbody>
            {report.summary.map((row) => (
              <SummaryRow key={row.month} row={row} label={monthLabel(row.month)} />
            ))}
            <SummaryRow row={report.summaryTotal} label="Financial year to date" strong />
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FyUnlinkedSales({ report }: { report: FyTraceabilityReport }) {
  if (report.unlinkedSales.length === 0) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-white overflow-hidden">
      <div className="px-4 py-1.5 border-b border-amber-200 bg-amber-50">
        <p className="font-semibold text-amber-900 text-xs">
          Sales not linked to a purchase line — {report.unlinkedSales.length} in the period, {fmtQ(report.unlinkedTotals.qty)} qty
        </p>
        <p className="text-[0.6875rem] text-amber-800">
          These dispatch lines name no purchase line, so they cannot reduce any line&apos;s Balance Qty above. Line
          balances overstate stock on hand by this quantity until the sales are linked.
        </p>
      </div>
      <div className="overflow-auto max-h-[50vh]">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[0.6875rem] uppercase">
            <tr className="border-b">
              <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Sale Date</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Invoice</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Customer</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Item</th>
              <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Size</th>
              <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Sale Qty</th>
              <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Sale Value</th>
              <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Sale GST</th>
            </tr>
          </thead>
          <tbody>
            {report.unlinkedSales.map((s, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-2 py-1 whitespace-nowrap">{fmtDate(s.date)}</td>
                <td className="px-2 py-1 font-mono">{s.reference}</td>
                <td className="px-2 py-1">{s.customer}</td>
                <td className="px-2 py-1">{s.description}</td>
                <td className="px-2 py-1 whitespace-nowrap">{s.size}</td>
                <td className={NUM}>{fmtQ(s.qty)}</td>
                <td className={NUM}>{fmtM(s.saleValue)}</td>
                <td className={NUM}>{fmtM(s.saleGst)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-300 bg-amber-50 font-semibold">
              <td className="px-2 py-1" colSpan={5}>Total</td>
              <td className={NUM}>{fmtQ(report.unlinkedTotals.qty)}</td>
              <td className={NUM}>{fmtM(report.unlinkedTotals.saleValue)}</td>
              <td className={NUM}>{fmtM(report.unlinkedTotals.saleGst)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
