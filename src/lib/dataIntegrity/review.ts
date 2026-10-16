// Review & Fix for an open Data Integrity exception (migration 165): what
// the review route returns and what the fix route accepts. A finding may
// carry a fix; the database re-checks it before changing anything.

export type ExceptionFix =
  | { kind: 'intercompany_transfer' }
  | { kind: 'output_item'; outputItemId: string }

export interface ReviewLink {
  label: string
  href: string
}

export interface ReviewFinding {
  kind: 'intercompany_transfer' | 'output_item' | 'no_purchase_line' | 'negative_line' | 'none'
  title: string
  detail: string
  // Table of the rows the finding is about (transfers to record, sales…).
  rows?: string[][]
  rowHeaders?: string[]
  links?: ReviewLink[]
  fix?: ExceptionFix
  fixLabel?: string
}

export interface ExceptionReview {
  findings: ReviewFinding[]
}

export type ExceptionFixRequest =
  | { kind: 'intercompany_transfer' }
  | { kind: 'output_item'; outputItemId: string }
