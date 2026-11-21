export type DomainResult =
  | { state: 'added' | 'already-added' }
  | { state: 'manual' | 'failed'; reason: string }

/** What still has to happen before the customer's address opens. */
export function DomainNote({ domain, host }: { domain: DomainResult; host: string }) {
  if (domain.state === 'added' || domain.state === 'already-added') {
    return (
      <p className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-800">
        Vercel is serving {host}. Its certificate is usually ready within a few minutes.
      </p>
    )
  }
  return (
    <div className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">{domain.state === 'failed' ? 'Vercel didn\'t accept the address' : 'One step left: add the address in Vercel'}</p>
      <p className="mt-1">{'reason' in domain ? domain.reason : ''}</p>
      <p className="mt-1">Until then, https://{host} doesn&apos;t open.</p>
    </div>
  )
}
