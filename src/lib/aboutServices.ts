// Content for the About WareCore page (/admin/about): the technology stack
// and every outside service WareCore depends on, with its plan, limits and
// where it bills. Plans and prices change — re-check each `sourceUrl` and
// bump PRICING_CHECKED_ON whenever this file is updated.

export const PRICING_CHECKED_ON = '2026-10-22'

export type TechGroup = {
  title: string
  items: { name: string; detail: string }[]
}

export const TECH_STACK: TechGroup[] = [
  {
    title: 'Application',
    items: [
      { name: 'Next.js 16', detail: 'Web framework — pages, reports and API routes' },
      { name: 'React 19', detail: 'User interface' },
      { name: 'TypeScript 6', detail: 'Programming language for the whole app' },
      { name: 'Tailwind CSS 4', detail: 'Styling' },
      { name: 'Lucide', detail: 'Icons' },
      { name: 'Progressive Web App', detail: 'Installable on phones and desktops from the browser' },
    ],
  },
  {
    title: 'Data',
    items: [
      { name: 'PostgreSQL 17', detail: 'The database — every bill, sale, job work order and stock ledger row' },
      { name: 'Hasura GraphQL Engine', detail: 'API layer between the app and the database' },
      { name: 'Database triggers & views', detail: 'Stock ledger postings, vendor balances and date checks run inside the database' },
    ],
  },
  {
    title: 'Features',
    items: [
      { name: 'Anthropic Claude', detail: 'AI Copilot — answers questions about stock and ledgers' },
      { name: 'ExcelJS & JSZip', detail: 'Excel exports and backup files' },
      { name: 'Nodemailer', detail: 'Password-reset emails' },
      { name: 'bcrypt & JSON Web Tokens', detail: 'Password storage and sign-in sessions' },
      { name: 'Google Sign-In (OAuth)', detail: 'Optional sign-in with a Google account' },
      { name: 'React Markdown', detail: 'Formatting Copilot answers' },
    ],
  },
  {
    title: 'Build & quality',
    items: [
      { name: 'Vitest', detail: 'Automated tests, run against a real throwaway PostgreSQL' },
      { name: 'ESLint', detail: 'Code checks' },
      { name: 'Embedded PostgreSQL', detail: 'Desktop build — runs the whole app offline on one PC' },
      { name: 'Git & GitHub', detail: 'Source code history' },
    ],
  },
]

export type ServiceStatus = 'free' | 'paid' | 'attention'

export type Service = {
  name: string
  usedFor: string
  plan: string
  status: ServiceStatus
  /** Short cost line for the summary table. */
  monthlyCost: string
  /** What the plan includes each month. */
  limits: string[]
  /** Which live figure on the page shows our usage, or where to look. */
  usageKey?: 'database' | 'copilot' | 'cron'
  usageWhere: string
  /** What happens once the included amount is used up. */
  whenLimitReached: string
  /** Where the charges land. */
  billedAt: { label: string; url: string } | null
  note?: string
  sourceUrl: string
}

export const SERVICES: Service[] = [
  {
    name: 'Vercel',
    usedFor: 'Hosts warecore.vercel.app — every page, report and API call, plus the nightly reconciliation scan',
    plan: 'Hobby (free)',
    status: 'attention',
    monthlyCost: '$0',
    limits: [
      '100 GB data transfer',
      '1,000,000 function invocations',
      '4 hours Active CPU',
      '360 GB-hours provisioned memory',
      'Cron jobs: once per day at most, ±59 min timing',
      'Runtime logs kept for 1 hour',
    ],
    usageKey: 'cron',
    usageWhere: 'Vercel dashboard → Usage',
    whenLimitReached:
      'Hobby has no pay-as-you-go. Vercel can pause the deployment, and the site stays down until usage resets or the plan is upgraded to Pro.',
    billedAt: { label: 'Vercel → Settings → Billing', url: 'https://vercel.com/account/billing' },
    note:
      'Vercel restricts Hobby to non-commercial personal use. WareCore runs a business, so Vercel’s terms require the Pro plan ($20 per member per month, usage beyond the included credit billed on demand).',
    sourceUrl: 'https://vercel.com/docs/limits/fair-use-guidelines',
  },
  {
    name: 'Hasura Cloud',
    usedFor: 'GraphQL API between the app and the database (every screen reads and writes through it)',
    plan: 'Free',
    status: 'attention',
    monthlyCost: '$0',
    limits: ['3,000,000 API requests per month', '100 MB data passthrough per month', 'Up to 3 projects'],
    usageWhere: 'Hasura Cloud → project → Usage',
    whenLimitReached:
      'Hasura doesn’t publish what happens at the cap; expect requests to be throttled or refused until the month resets or the project moves to Professional ($1.50 per active hour + $0.13/GB passthrough).',
    billedAt: { label: 'Hasura Cloud → Billing', url: 'https://cloud.hasura.io/billing' },
    note:
      '100 MB of passthrough is the tightest limit WareCore has: a full-year Stock Statement alone moves several MB. Check the Usage tab monthly.',
    sourceUrl: 'https://hasura.io/pricing/v2',
  },
  {
    name: 'Neon',
    usedFor: 'Managed PostgreSQL database (AWS Singapore)',
    plan: 'Launch (paid, usage-based)',
    status: 'paid',
    monthlyCost: 'Pay per use, no minimum',
    limits: [
      'Compute: $0.106 per CU-hour (sleeps when idle, so idle time is free)',
      'Storage: $0.35 per GB-month',
      '500 GB public data transfer included, then $0.10/GB',
      'Point-in-time history up to 7 days',
    ],
    usageKey: 'database',
    usageWhere: 'Neon console → Billing',
    whenLimitReached:
      'No cap on a paid plan — usage keeps running and is added to the month’s invoice. Bills under $0.50 are not collected.',
    billedAt: { label: 'Neon console → Billing (monthly invoice)', url: 'https://console.neon.tech/app/billing' },
    note: 'Compute time is most of the bill; storage is pennies at the current size.',
    sourceUrl: 'https://neon.com/pricing',
  },
  {
    name: 'Anthropic API (Claude)',
    usedFor: 'AI Copilot chat',
    plan: 'Pay as you go (prepaid credits)',
    status: 'paid',
    monthlyCost: 'Per question asked',
    limits: ['Model: Claude Opus 4.8', '$5 per million input tokens', '$25 per million output tokens'],
    usageKey: 'copilot',
    usageWhere: 'Claude Console → Usage',
    whenLimitReached:
      'When prepaid credits run out the Copilot stops answering (unless auto-reload is on). The rest of WareCore keeps working.',
    billedAt: { label: 'Claude Console → Billing', url: 'https://platform.claude.com/settings/billing' },
    note: 'Costs nothing in a month when nobody uses the Copilot.',
    sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  {
    name: 'Gmail (SMTP)',
    usedFor: 'Sends password-reset emails',
    plan: 'Free',
    status: 'free',
    monthlyCost: '$0',
    limits: ['About 500 emails per day from one Gmail account'],
    usageWhere: 'Gmail → Sent folder of the sending account',
    whenLimitReached: 'Google blocks sending for up to 24 hours. Nothing is billed.',
    billedAt: null,
    sourceUrl: 'https://support.google.com/mail/answer/22839',
  },
  {
    name: 'Google Cloud (Sign-In)',
    usedFor: '“Sign in with Google” on the login page',
    plan: 'Free',
    status: 'free',
    monthlyCost: '$0',
    limits: ['No charge for Google Sign-In'],
    usageWhere: 'Google Cloud console → APIs & Services → Credentials',
    whenLimitReached: 'No usage limit applies at WareCore’s scale. Nothing is billed.',
    billedAt: null,
    sourceUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  {
    name: 'GitHub',
    usedFor: 'Stores the source code (private repository)',
    plan: 'Free',
    status: 'free',
    monthlyCost: '$0',
    limits: ['Unlimited private repositories'],
    usageWhere: 'github.com → Settings → Billing',
    whenLimitReached: 'WareCore doesn’t use any paid GitHub feature. Nothing is billed.',
    billedAt: null,
    sourceUrl: 'https://github.com/pricing',
  },
]
