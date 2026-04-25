import Link from 'next/link'

export interface MasterDataCheck {
  label: string        // e.g. "Companies"
  count: number        // how many exist
  adminPath: string    // link to admin page to add them
}

interface Props {
  checks: MasterDataCheck[]
  /** Optional — if true, loading is still in progress so don't show yet */
  loading?: boolean
}

/**
 * Shows a warning banner listing any master data that is missing,
 * with direct links to the admin pages to set them up.
 */
export default function MissingMasterDataBanner({ checks, loading }: Props) {
  if (loading) return null

  const missing = checks.filter((c) => c.count === 0)
  if (missing.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex gap-3">
        <span className="text-amber-500 text-lg leading-none mt-0.5">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-800">
            Master data required before creating this transaction
          </p>
          <p className="mt-1 text-sm text-amber-700">
            The following must be set up first:
          </p>
          <ul className="mt-2 space-y-1">
            {missing.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-sm text-amber-800">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span>No <strong>{item.label}</strong> found —</span>
                <Link
                  href={item.adminPath}
                  className="font-medium text-blue-600 hover:text-blue-800 underline underline-offset-2"
                >
                  Add {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
