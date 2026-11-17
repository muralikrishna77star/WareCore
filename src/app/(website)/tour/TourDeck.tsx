'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check, Mail, Phone, Printer, LogIn } from 'lucide-react'
import type { TourSlide } from '@/lib/marketing/productTour'

type Contact = { email: string; phone: string; phoneHref: string }

// Slide number lives in the URL hash (#3) so a link can open the tour at a
// given slide, and Back/Forward don't pile up one history entry per click.
function slideFromHash(count: number): number {
  if (typeof window === 'undefined') return 0
  const n = Number(window.location.hash.replace('#', ''))
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : 0
}

// replaceState doesn't fire hashchange, so go() announces the move itself.
const SLIDE_EVENT = 'warecore-tour-slide'
function subscribeToSlide(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  window.addEventListener(SLIDE_EVENT, onChange)
  return () => {
    window.removeEventListener('hashchange', onChange)
    window.removeEventListener(SLIDE_EVENT, onChange)
  }
}

export default function TourDeck({ slides, contact }: { slides: TourSlide[]; contact: Contact }) {
  const total = slides.length
  const index = useSyncExternalStore(subscribeToSlide, () => slideFromHash(total), () => 0)
  const touchStartX = useRef<number | null>(null)

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total - 1, next))
      window.history.replaceState(null, '', `#${clamped + 1}`)
      window.dispatchEvent(new Event(SLIDE_EVENT))
    },
    [total]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        go(index + 1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        go(index - 1)
      } else if (e.key === 'Home') {
        go(0)
      } else if (e.key === 'End') {
        go(total - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index, total])

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current
    touchStartX.current = null
    if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1))
  }

  const isLast = index === total - 1

  return (
    <main className="bg-slate-50 print:bg-white">
      {/* Toolbar */}
      <div className="border-b bg-white print:hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">Product Tour</p>
            <p className="text-sm text-gray-500">Use the arrow keys or swipe to move between slides.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <Printer className="h-4 w-4" /> Save as PDF
            </button>
            <a
              href="#contact-us"
              onClick={(e) => {
                e.preventDefault()
                go(total - 1)
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Book a demo
            </a>
          </div>
        </div>
        {/* Progress */}
        <div className="h-1 bg-gray-100" aria-hidden="true">
          <div className="h-1 bg-blue-600 transition-all duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
      </div>

      <section
        className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 print:p-0 print:max-w-none"
        aria-roledescription="carousel"
        aria-label="WareCore product tour"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <p className="sr-only" aria-live="polite">
          Slide {index + 1} of {total}
        </p>
        {slides.map((slide, i) => (
          <article
            key={i}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${total}`}
            aria-hidden={i !== index}
            className={`${i === index ? 'block' : 'hidden'} print:block print:break-after-page print:[break-inside:avoid]`}
          >
            <div className="rounded-2xl border bg-white shadow-sm overflow-hidden lg:min-h-[560px] print:shadow-none print:border-0 print:rounded-none">
              <SlideBody slide={slide} contact={contact} />
            </div>
            <p className="hidden print:block text-right text-xs text-gray-400 mt-2">
              WareCore Product Tour · {i + 1} / {total}
            </p>
          </article>
        ))}

        {/* Navigation */}
        <nav className="mt-6 flex items-center justify-between gap-4 print:hidden" aria-label="Tour navigation">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="h-4 w-4" /> Previous
          </button>

          <div className="hidden sm:flex items-center gap-1.5" role="tablist" aria-label="Choose a slide">
            {slides.map((s, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Slide ${i + 1}: ${s.title}`}
                title={s.eyebrow}
                onClick={() => go(i)}
                className={`h-2.5 rounded-full transition-all ${i === index ? 'w-6 bg-blue-600' : 'w-2.5 bg-gray-300 hover:bg-gray-400'}`}
              />
            ))}
          </div>
          <span className="sm:hidden text-sm text-gray-500 tabular-nums">
            {index + 1} / {total}
          </span>

          {isLast ? (
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl border bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to home
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => go(index + 1)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </nav>
      </section>
    </main>
  )
}

function Screenshot({ src, alt, cropTop }: { src: string; alt: string; cropTop?: number }) {
  return (
    <figure className="rounded-xl border border-slate-200 bg-slate-100 shadow-lg overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-200/70 border-b border-slate-200" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
      </div>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: `1440 / ${Math.round(900 * (cropTop ?? 1))}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={1440} height={900} className="absolute inset-x-0 top-0 w-full h-auto" />
      </div>
    </figure>
  )
}

function SlideBody({ slide, contact }: { slide: TourSlide; contact: Contact }) {
  switch (slide.kind) {
    case 'cover':
      return (
        <div className="grid lg:grid-cols-2 gap-8 p-6 sm:p-10 lg:p-12 items-center bg-gradient-to-br from-blue-700 to-blue-900 text-white lg:min-h-[560px] print:[print-color-adjust:exact]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-blue-200 mb-4">{slide.eyebrow}</p>
            <h1 className="text-3xl sm:text-4xl font-bold leading-tight mb-5">{slide.title}</h1>
            <p className="text-lg text-blue-100">{slide.subtitle}</p>
          </div>
          <Screenshot src={slide.image} alt={slide.imageAlt} />
        </div>
      )
    case 'points':
      return (
        <div className="p-6 sm:p-10 lg:p-12">
          <Eyebrow text={slide.eyebrow} />
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">{slide.title}</h2>
          {slide.intro && <p className="text-gray-600 mb-8 max-w-3xl">{slide.intro}</p>}
          <div className="grid sm:grid-cols-2 gap-4 sm:gap-5">
            {slide.points.map((p, i) => (
              <div key={p.title} className="rounded-xl border bg-slate-50 p-5">
                <p className="text-sm font-semibold text-blue-600 mb-1 tabular-nums">0{i + 1}</p>
                <h3 className="font-semibold text-gray-900 mb-1.5">{p.title}</h3>
                <p className="text-sm text-gray-600">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      )
    case 'flow':
      return (
        <div className="p-6 sm:p-10 lg:p-12">
          <Eyebrow text={slide.eyebrow} />
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">{slide.title}</h2>
          <p className="text-gray-600 mb-8 max-w-3xl">{slide.intro}</p>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {slide.steps.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border-2 border-blue-100 bg-blue-50/50 p-5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white text-sm font-bold mb-3 print:[print-color-adjust:exact]">
                  {i + 1}
                </span>
                <h3 className="font-semibold text-gray-900 mb-1.5">{s.title}</h3>
                <p className="text-sm text-gray-600">{s.text}</p>
                {i < slide.steps.length - 1 && (
                  <ArrowRight className="hidden lg:block absolute -right-4 top-1/2 -translate-y-1/2 h-6 w-6 text-blue-300 z-10 bg-white rounded-full" aria-hidden="true" />
                )}
              </li>
            ))}
          </ol>
          <p className="mt-8 rounded-xl bg-green-50 border border-green-200 px-5 py-4 text-green-900 text-sm sm:text-base">
            <Check className="inline h-4 w-4 mr-1.5 -mt-0.5" aria-hidden="true" />
            {slide.footnote}
          </p>
        </div>
      )
    case 'feature':
      return (
        <div className="grid lg:grid-cols-5 gap-8 p-6 sm:p-10 lg:p-12 items-center">
          <div className="lg:col-span-2">
            <Eyebrow text={slide.eyebrow} />
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3 leading-tight">{slide.title}</h2>
            <p className="text-gray-600 mb-5">{slide.intro}</p>
            <ul className="space-y-2.5">
              {slide.bullets.map((b) => (
                <li key={b} className="flex gap-2.5 text-sm text-gray-700">
                  <Check className="h-4 w-4 mt-0.5 shrink-0 text-green-600" aria-hidden="true" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-3">
            <Screenshot src={slide.image} alt={slide.imageAlt} cropTop={slide.cropTop} />
          </div>
        </div>
      )
    case 'contact':
      return (
        <div className="grid lg:grid-cols-2 gap-8 p-6 sm:p-10 lg:p-12 items-center lg:min-h-[560px]">
          <div>
            <Eyebrow text={slide.eyebrow} />
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3 leading-tight">{slide.title}</h2>
            <p className="text-gray-600 mb-6">{slide.intro}</p>
            <ul className="space-y-2.5">
              {slide.offers.map((o) => (
                <li key={o} className="flex gap-2.5 text-gray-700">
                  <Check className="h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </div>
          <div id="contact-us" className="rounded-2xl bg-gradient-to-br from-blue-700 to-blue-900 text-white p-6 sm:p-8 space-y-5 print:[print-color-adjust:exact]">
            <p className="text-lg font-semibold">Book your demo</p>
            <a href={`mailto:${contact.email}?subject=${encodeURIComponent('WareCore demo')}`} className="flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/20 px-4 py-3 transition-colors break-all">
              <Mail className="h-5 w-5 shrink-0" aria-hidden="true" /> {contact.email}
            </a>
            <a href={contact.phoneHref} className="flex items-center gap-3 rounded-xl bg-white/10 hover:bg-white/20 px-4 py-3 transition-colors">
              <Phone className="h-5 w-5 shrink-0" aria-hidden="true" /> {contact.phone}
            </a>
            <Link href="/login" className="flex items-center gap-3 rounded-xl border border-white/30 px-4 py-3 text-blue-100 hover:bg-white/10 transition-colors print:hidden">
              <LogIn className="h-5 w-5 shrink-0" aria-hidden="true" /> Already a customer? Sign in
            </Link>
          </div>
        </div>
      )
  }
}

function Eyebrow({ text }: { text: string }) {
  return <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-2">{text}</p>
}
