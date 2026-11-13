'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen, ChevronRight, LifeBuoy, ListOrdered, MapPin, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  HELP_ARTICLES, HELP_CATEGORIES, helpForPath, helpIndex, searchHelp, type HelpArticle,
} from '@/lib/help/articles'

function ArticleRow({ a, showCategory = false }: { a: HelpArticle; showCategory?: boolean }) {
  return (
    <Link
      href={`/help/${a.slug}`}
      className="group flex items-start justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-blue-50 transition-colors"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900 group-hover:text-blue-700">{a.title}</span>
        <span className="block text-xs text-gray-500 mt-0.5">
          {showCategory && <span className="font-medium text-gray-600">{a.category} · </span>}
          {a.summary}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 mt-0.5 text-gray-300 group-hover:text-blue-500" />
    </Link>
  )
}

export function HelpCenter({ initialQuery, from, initialTab }: { initialQuery: string; from: string; initialTab: 'topics' | 'index' }) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)
  const [tab, setTab] = useState<'topics' | 'index'>(initialTab)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Keep ?q= in the address bar so a search can be bookmarked or shared.
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (from) params.set('from', from)
      if (tab === 'index') params.set('tab', 'index')
      const qs = params.toString()
      router.replace(qs ? `/help?${qs}` : '/help', { scroll: false })
    }, 300)
    return () => clearTimeout(t)
  }, [query, from, tab, router])

  const results = useMemo(() => searchHelp(query), [query])
  const forScreen = useMemo(() => (from ? helpForPath(from) : []), [from])
  const index = useMemo(() => helpIndex(), [])
  const letters = useMemo(() => [...new Set(index.map((e) => e.term[0].toUpperCase()))], [index])
  const searching = query.trim().length > 0

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 rounded-2xl bg-gradient-to-br from-slate-800 to-blue-900 px-6 py-8 text-white shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <LifeBuoy className="h-7 w-7 text-blue-200" />
          <h1 className="text-2xl font-bold">Help &amp; How-To</h1>
        </div>
        <p className="text-sm text-blue-100 mb-5">
          Step-by-step guides for every activity in WareCore. Search, or browse by topic.
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.length > 0) router.push(`/help/${results[0].slug}`)
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="What do you want to do? e.g. customer return, transfer to vendor, import bills"
            aria-label="Search help"
            className="w-full rounded-xl border-0 bg-white py-3 pl-11 pr-10 text-sm text-gray-900 placeholder:text-gray-400 shadow focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {searching ? (
        <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {results.length === 0 ? 'No guides found' : `${results.length} guide${results.length === 1 ? '' : 's'} found`}
          </p>
          {results.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-gray-600">
              Try a shorter word, such as &quot;bill&quot;, &quot;sale&quot;, &quot;vendor&quot; or &quot;stock&quot;, or browse the{' '}
              <button type="button" className="text-blue-600 hover:underline" onClick={() => { setQuery(''); setTab('index') }}>A–Z index</button>.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {results.map((a) => <ArticleRow key={a.slug} a={a} showCategory />)}
            </div>
          )}
        </section>
      ) : (
        <>
          {forScreen.length > 0 && (
            <section className="mb-6 rounded-xl border border-blue-200 bg-blue-50/60 p-3 shadow-sm">
              <p className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-blue-700">
                <MapPin className="h-3.5 w-3.5" /> Help for the screen you were on
              </p>
              <div className="divide-y divide-blue-100">
                {forScreen.map((a) => <ArticleRow key={a.slug} a={a} />)}
              </div>
            </section>
          )}

          <div className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm" role="tablist">
            {([['topics', 'By topic', BookOpen], ['index', 'A–Z index', ListOrdered]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          {tab === 'topics' ? (
            <div className="grid gap-4 md:grid-cols-2">
              {HELP_CATEGORIES.map((c) => {
                const items = HELP_ARTICLES.filter((a) => a.category === c.name)
                if (!items.length) return null
                return (
                  <section key={c.name} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="px-3 pt-2 pb-1">
                      <h2 className="text-base font-semibold text-gray-900">{c.name}</h2>
                      <p className="text-xs text-gray-500">{c.blurb}</p>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {items.map((a) => <ArticleRow key={a.slug} a={a} />)}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <nav className="mb-4 flex flex-wrap gap-1" aria-label="Jump to letter">
                {letters.map((l) => (
                  <a key={l} href={`#letter-${l}`} className="inline-flex h-7 w-7 items-center justify-center rounded text-sm font-semibold text-blue-700 hover:bg-blue-50">
                    {l}
                  </a>
                ))}
              </nav>
              <div className="columns-1 sm:columns-2 lg:columns-3 gap-6">
                {letters.map((l) => (
                  <div key={l} id={`letter-${l}`} className="break-inside-avoid mb-4">
                    <p className="mb-1 text-lg font-bold text-gray-300">{l}</p>
                    <ul className="space-y-1">
                      {index.filter((e) => e.term[0].toUpperCase() === l).map((e) => (
                        <li key={e.slug}>
                          <Link href={`/help/${e.slug}`} className="text-sm text-gray-800 hover:text-blue-700 hover:underline">{e.term}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
