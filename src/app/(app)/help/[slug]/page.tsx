import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, ExternalLink, Lightbulb, Search } from 'lucide-react'
import { HELP_ARTICLES, HELP_BY_SLUG, helpScreenshotSrc } from '@/lib/help/articles'

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const a = HELP_BY_SLUG[slug]
  return { title: a ? `${a.title} · Help · WareCore` : 'Help · WareCore' }
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const a = HELP_BY_SLUG[slug]
  if (!a) notFound()

  const shot = helpScreenshotSrc(a)
  const related = (a.related ?? []).map((s) => HELP_BY_SLUG[s]).filter(Boolean)
  const inCategory = HELP_ARTICLES.filter((x) => x.category === a.category)
  const pos = inCategory.findIndex((x) => x.slug === a.slug)
  const next = inCategory[pos + 1]
  // Screens with an id in the path ("/bills/[id]") can't be opened directly.
  const canOpen = !a.path.includes('[') && a.path !== '/login'

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/help" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> All help topics
        </Link>
        <Link href="/help" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          <Search className="h-4 w-4" /> Search help
        </Link>
      </div>

      <article className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <header className="border-b border-gray-100 px-6 py-5">
          <Link
            href={`/help?q=${encodeURIComponent(a.category)}`}
            className="inline-block rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            {a.category}
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{a.title}</h1>
          <p className="mt-1 text-gray-600">{a.summary}</p>
          {canOpen && (
            <Link
              href={a.path}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Open this screen: {a.pathLabel} <ExternalLink className="h-4 w-4" />
            </Link>
          )}
        </header>

        <div className="grid gap-6 px-6 py-6 lg:grid-cols-5">
          <section className={shot ? 'lg:col-span-2' : 'lg:col-span-5'}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Steps</h2>
            <ol className="space-y-3">
              {a.steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{i + 1}</span>
                  <span className="text-sm leading-6 text-gray-800">{step}</span>
                </li>
              ))}
            </ol>

            {a.tips && a.tips.length > 0 && (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
                  <Lightbulb className="h-4 w-4" /> Good to know
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                  {a.tips.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}
          </section>

          {shot && (
            <figure className="lg:col-span-3">
              <a href={shot} target="_blank" rel="noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element -- static screenshot from public/, shown as-is */}
                <img
                  src={shot}
                  alt={`Screenshot: ${a.pathLabel}`}
                  className="w-full rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
                  loading="lazy"
                />
              </a>
              <figcaption className="mt-2 text-xs text-gray-500">{a.pathLabel} (demo data). Click to enlarge.</figcaption>
            </figure>
          )}
        </div>

        {(related.length > 0 || next) && (
          <footer className="grid gap-4 border-t border-gray-100 bg-gray-50 px-6 py-5 sm:grid-cols-2">
            {related.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Related</p>
                <ul className="space-y-1">
                  {related.map((r) => (
                    <li key={r.slug}>
                      <Link href={`/help/${r.slug}`} className="text-sm text-blue-700 hover:underline">{r.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {next && (
              <div className="sm:text-right">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Next in {a.category}</p>
                <Link href={`/help/${next.slug}`} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
                  {next.title} <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </footer>
        )}
      </article>
    </div>
  )
}
