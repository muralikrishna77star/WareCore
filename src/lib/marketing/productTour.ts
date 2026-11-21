// Public Product Tour (/tour) — the marketing version of the WareCore User
// Guide deck. Screenshots are the Help screenshots of the fictional demo
// companies (Sunrise Steels / Apex Metal Works), copied to
// public/assets/tour/ so visitors who aren't signed in can load them. Never
// put production data here.
//
// Keep every claim true of the shipped product: this page is what
// prospective buyers read.

export const SALES_CONTACT = {
  email: 'makfreelancer77@gmail.com',
  phone: '+91 77080 80484',
  phoneHref: 'tel:+917708080484',
}

export type TourSlide =
  | {
      kind: 'cover'
      eyebrow: string
      title: string
      subtitle: string
      image: string
      imageAlt: string
    }
  | {
      kind: 'points'
      eyebrow: string
      title: string
      intro?: string
      points: { title: string; text: string }[]
    }
  | {
      kind: 'flow'
      eyebrow: string
      title: string
      intro: string
      steps: { title: string; text: string }[]
      footnote: string
    }
  | {
      kind: 'feature'
      eyebrow: string
      title: string
      intro: string
      bullets: string[]
      image: string
      imageAlt: string
      /** Show only the top part of the screenshot (0–1 of its height). */
      cropTop?: number
    }
  | {
      kind: 'contact'
      eyebrow: string
      title: string
      intro: string
      offers: string[]
    }

const shot = (name: string) => `/assets/tour/${name}.jpg`

export const TOUR_SLIDES: TourSlide[] = [
  {
    kind: 'cover',
    eyebrow: 'WareCore Product Tour',
    title: 'Know where every tonne of steel is — in your yard or at your vendor',
    subtitle:
      'Purchases, stock, job work, vendor transfers and sales for steel traders and processors, in one system that always balances.',
    image: shot('dashboard'),
    imageAlt: 'WareCore dashboard showing total stock across two companies, purchase bills, active job work and dispatches',
  },
  {
    kind: 'points',
    eyebrow: 'The challenge',
    title: 'Spreadsheets stop adding up once material starts moving',
    intro: 'Steel businesses rarely keep stock in one place. A typical week looks like this:',
    points: [
      { title: 'Several companies, several yards', text: 'Sister companies buy, store and sell from different warehouses — and lend material to each other.' },
      { title: 'Material at job work vendors', text: 'Coils go out for slitting, cutting or galvanizing. Some come back, some move to the next vendor, some are sold straight from the vendor.' },
      { title: 'Corrections everywhere', text: 'Bills get cancelled, quantities get edited, customers return material. Each change must flow through to stock.' },
      { title: 'Month-end surprises', text: 'Stock statements and vendor balances disagree, and nobody can say which entry caused it.' },
    ],
  },
  {
    kind: 'flow',
    eyebrow: 'How WareCore works',
    title: 'One ledger from purchase to sale',
    intro: 'Every screen posts to the same stock ledger, so every report reads the same numbers.',
    steps: [
      { title: 'Purchase', text: 'Enter bills or import them from Excel. Each line gets a traceable Purchase Line ID.' },
      { title: 'Warehouse', text: 'Stock lands in the right company and warehouse, by item and size.' },
      { title: 'Job Work', text: 'Send material to vendors, record outputs and returns, move it between vendors.' },
      { title: 'Sale', text: 'Sell from the warehouse or straight from a vendor. Returns go back into stock.' },
    ],
    footnote: 'Cancel or edit anything and the stock moves with it — with a full record of who changed what, and when.',
  },
  {
    kind: 'feature',
    eyebrow: 'Live inventory',
    title: 'Stock by company, warehouse, item and size — right now',
    intro: 'No waiting for month-end. The moment a bill, transfer or dispatch is saved, stock is updated everywhere.',
    bullets: [
      'Totals per company and per warehouse',
      'Item Master with codes, material types and sizes',
      'Transfers between warehouses and sister companies',
      'Export any list to Excel in one click',
    ],
    image: shot('inventory'),
    imageAlt: 'Current Inventory screen listing stock per warehouse, material and size for two companies',
  },
  {
    kind: 'feature',
    eyebrow: 'Job work',
    title: 'Send material for processing — and get every kilo accounted for',
    intro: 'A job work order records what went to the vendor, which purchase line it came from, and what came back.',
    bullets: [
      'Input materials and produced outputs on one order',
      'Partial returns, multiple returns, and output of a different size',
      'Orders complete themselves when nothing is left at the vendor',
      'Dates are checked: nothing can be sent before it was bought',
    ],
    image: shot('create-job-work'),
    imageAlt: 'New Job Work Order form with input materials sent to a vendor and output materials produced',
  },
  {
    kind: 'feature',
    eyebrow: 'Vendor-to-vendor transfers',
    title: 'Move material between vendors without bringing it back',
    intro: 'Slit coils going straight from the slitter to the galvanizer? Record it as a transfer — both vendor balances update together.',
    bullets: [
      'Transfer any quantity still pending at a vendor',
      'Send processed output on to the next vendor',
      'Reverse a transfer line by line if it was entered wrongly',
      'Both sides of every transfer always stay paired',
    ],
    image: shot('transfer-job-work'),
    imageAlt: 'Transfer Job Work to Another Vendor screen showing the pending item and quantity to transfer',
  },
  {
    kind: 'feature',
    eyebrow: 'Direct sales from vendors',
    title: 'Sell material while it is still at the vendor',
    intro: 'Customers often take delivery straight from the processor. WareCore records the sale against the vendor, with no fake trip back to your yard.',
    bullets: [
      'Pick the job work order and sell what is pending there',
      'Quantity checked against what the vendor actually holds',
      'Tax rates, customer, vehicle and driver on the same screen',
      'Vendor balance and company stock both reduce correctly',
    ],
    image: shot('vendor-direct-sale'),
    imageAlt: 'Vendor Direct Sale screen showing items pending at a job work vendor and quantities to sell',
  },
  {
    kind: 'feature',
    eyebrow: 'Vendorwise stock',
    title: 'Know exactly what each vendor is holding for you',
    intro: 'Opening balance, material sent, transfers, returns and direct sales — per vendor and item, for any date range.',
    bullets: [
      'Closing balance per vendor, item and size',
      'Valuation of stock lying at vendors',
      'A built-in check that the movements add up to the balance',
      'Drill into every transaction behind a number',
    ],
    image: shot('vendor-movements'),
    imageAlt: 'Vendorwise Stock Movement report with opening balance, job work out, transfers, returns, direct sales and a reconciled closing balance',
  },
  {
    kind: 'feature',
    eyebrow: 'Reports',
    title: 'Stock statements your accountant can trust',
    intro: 'Opening stock, purchases, transfers, job work, sales and closing stock — warehouse and vendor — for any period.',
    bullets: [
      'Stock Statement and Day-wise Stock Statement',
      'Purchase, sales, dispatch, transfer and job work reports',
      'Weighted-average valuation from your actual purchase rates',
      'Print or export every report to Excel',
    ],
    image: shot('stock-statement'),
    imageAlt: 'Stock Statement report with filters and totals for warehouse and vendor stock and stock value',
  },
  {
    kind: 'feature',
    eyebrow: 'Traceability',
    title: 'Follow any item, any purchase line, any day',
    intro: 'Every movement of an item is listed with its running balance — in your warehouse and at your vendors.',
    bullets: [
      'Item Stock Ledger with warehouse and vendor balances',
      'Purchase Line Movements: one bill line, end to end',
      'Click through from any reference to the order behind it',
      'Deleted ledger rows are archived, never silently lost',
    ],
    image: shot('item-ledger'),
    imageAlt: 'Item Stock Ledger showing opening balance, inward, outward, warehouse stock and stock at vendor for one item',
  },
  {
    kind: 'feature',
    eyebrow: 'Financial year view',
    title: 'Purchase to sale, line by line, for the whole year',
    intro: 'The FY Purchase & Sales Traceability report shows what became of every purchase line — sold, returned, at a vendor or still in stock.',
    bullets: [
      'Purchases of the year with their linked sales',
      'Balance in warehouse and at vendors per line',
      'Stock value at purchase rate',
      'Monthly summary and Excel export',
    ],
    image: shot('fy-traceability'),
    imageAlt: 'FY Purchase and Sales Traceability report with purchase lines, their sales and balances',
  },
  {
    kind: 'feature',
    eyebrow: 'QR bundle tracking',
    title: 'Every bundle labelled, every bundle findable',
    intro: 'An optional add-on, switched on per company: each purchased bundle gets its own QR label, so anyone can scan it and see what it is, where it is and what has happened to it.',
    bullets: [
      'A QR label per bundle, with bundle weights checked against the bill',
      'Named yard locations: scan a bundle, then a rack, to put it away or move it',
      'A status for every bundle, from In stock and On hold to Picked up, with full history',
      'Scan with a phone camera, a handheld scanner or by typing the ID',
      'Tracking never changes your stock figures',
    ],
    image: shot('qr-tracked-units'),
    imageAlt: 'Tracked Units screen listing labelled bundles with their weight, bundle number, purchase line, yard location and status',
  },
  {
    kind: 'feature',
    eyebrow: 'Customer pickup',
    title: 'Hand the right bundles to the right truck',
    intro: 'Build a pickup by scanning bundles, mark it ready in the loading bay, and record who collected it — even before the sale is entered.',
    bullets: [
      'Scan bundles onto a pickup; a bundle can never be on two pickups at once',
      'Customer taking part of a bundle? Split it into new labelled parts',
      'Share the pickup details with the customer on WhatsApp',
      'Collector name, phone and vehicle number recorded at handover',
      'Link the sale now or later, and any difference is flagged',
    ],
    image: shot('qr-pickup'),
    imageAlt: 'Pickup screen showing two bundles ready in the loading bay and a pre-written WhatsApp message for the customer',
  },
  {
    kind: 'feature',
    eyebrow: 'QR job work tracking',
    title: 'Follow each bundle to the vendor and back',
    intro: 'Scan bundles onto a vendor dispatch, see them at the vendor beside the book balance, and label the processed output with a link to what it was made from.',
    bullets: [
      'Scan each bundle as it is loaded, then mark the dispatch sent',
      'Bundles at each vendor, beside the vendor balance in your books',
      'Record bundles that go straight on to the next vendor',
      'Output labels keep a "made from" link to the input bundles and their purchase lines',
      'Link the job work order now, or after it has been entered',
    ],
    image: shot('qr-vendor-stock'),
    imageAlt: 'Vendor Stock screen listing labelled bundles at each job work vendor beside the book balance at that vendor',
  },
  {
    kind: 'feature',
    eyebrow: 'Yard control',
    title: 'Run the yard from one screen, even where there is no signal',
    intro: 'A tracking dashboard shows what needs doing today, and the Offline Scan screen keeps phones scanning in corners of the yard with no network.',
    bullets: [
      'Bundles not put away, pickups waiting and failed prints at a glance',
      'Rack-by-rack stock counts, with a manager deciding each difference',
      'Offline scanning on the phone; scans are sent when the signal returns',
      'Six reports, from Stock Ageing to Tracked vs Book, with Excel export',
    ],
    image: shot('qr-tracking-dashboard'),
    imageAlt: 'QR Tracking dashboard with needs-action tiles, bundles by status, labelled share of book stock and bundles at vendors',
  },
  {
    kind: 'feature',
    eyebrow: 'Data integrity',
    title: 'A control centre that finds problems before your auditor does',
    intro: 'WareCore checks its own data against a catalogue of reconciliation rules and explains anything that does not add up.',
    bullets: [
      'Duplicate, missing and orphaned ledger entries detected',
      'Negative stock and vendor balances flagged with severity',
      'Each exception shows the ledger rows behind it and a likely cause',
      'Scans are read-only — checking never changes your stock',
    ],
    image: shot('data-integrity-dashboard'),
    imageAlt: 'Data Integrity and Reconciliation Control Centre showing a Healthy status and zero open exceptions',
    cropTop: 0.62,
  },
  {
    kind: 'feature',
    eyebrow: 'WareCore Copilot',
    title: 'Ask about your stock in plain English',
    intro: 'The built-in AI assistant answers questions about items and their movements, right from the screen you are on.',
    bullets: [
      'Look up an item’s stock and its ledger',
      'Suggested questions for the current screen',
      'Conversations are saved so you can pick up later',
    ],
    image: shot('ask-copilot'),
    imageAlt: 'WareCore Copilot panel open over the dashboard with topic buttons and suggested questions',
  },
  {
    kind: 'feature',
    eyebrow: 'Built for your team',
    title: 'The right access for every person',
    intro: 'Owners, accountants, warehouse staff and managers each see what they need — and change only what they should.',
    bullets: [
      'Custom roles with read / write permission per screen',
      'See who created and last changed bills, orders and sales',
      'Works on phone and tablet; installs like an app',
      'Searchable in-app Help with a step-by-step guide for every task',
      'Full backup and restore; a desktop edition can run on a single PC',
    ],
    image: shot('roles-permissions'),
    imageAlt: 'New Role screen with read and write permission checkboxes for each screen',
  },
  {
    kind: 'contact',
    eyebrow: 'Next step',
    title: 'See WareCore with your own material and workflow',
    intro: 'Tell us how your companies, yards and job work vendors are set up, and we will walk you through WareCore on a live demo.',
    offers: [
      'A guided demo for your team',
      'Help setting up your companies, items and opening stock',
      'Bulk import of purchase bills from Excel',
    ],
  },
]
