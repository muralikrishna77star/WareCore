// One place for how WareCore shows dates and times: always dd-Mmm-yyyy
// (24-Nov-2026), always in India time (Asia/Kolkata), whether the page is
// drawn in the browser or on the server. Vercel's servers and the database
// run in UTC, so formatting without a fixed zone showed server-drawn times
// 5 h 30 min behind and put entries made between midnight and 5:30 am IST
// on the previous day.
//
// Plain dates ("2026-11-12", a bill date or dispatch date) are calendar
// days with no clock time: they are shown exactly as stored and are never
// shifted by any time zone.

export const APP_TIME_ZONE = 'Asia/Kolkata'

export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

type DateValue = string | number | Date | null | undefined

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const istParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

type Parts = { y: number; m: number; d: number; hh: number; mm: number; ss: number; hasTime: boolean }

function toParts(value: DateValue): Parts | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') {
    const plain = PLAIN_DATE.exec(value.trim())
    if (plain) return { y: +plain[1], m: +plain[2], d: +plain[3], hh: 0, mm: 0, ss: 0, hasTime: false }
  }
  // Postgres text timestamps ("2026-11-24 08:20:00+00") need a T and a full offset.
  const date = value instanceof Date ? value : new Date(
    typeof value === 'string' ? value.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00') : value,
  )
  if (Number.isNaN(date.getTime())) return null
  const p: Record<string, number> = {}
  for (const part of istParts.formatToParts(date)) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return { y: p.year, m: p.month, d: p.day, hh: p.hour === 24 ? 0 : p.hour, mm: p.minute, ss: p.second, hasTime: true }
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayPart = (p: Parts) => `${pad(p.d)}-${MONTH_ABBR[p.m - 1]}-${p.y}`
const timePart = (p: Parts) => `${pad(p.hh % 12 || 12)}:${pad(p.mm)} ${p.hh < 12 ? 'am' : 'pm'}`

/** 24-Nov-2026. Empty or unreadable values give `fallback` (default ''). */
export function formatDate(value: DateValue, fallback = ''): string {
  const p = toParts(value)
  return p ? dayPart(p) : value ? String(value) : fallback
}

/** 24-Nov-2026 01:50 pm (India time). A plain date gives just the day. */
export function formatDateTime(value: DateValue, fallback = ''): string {
  const p = toParts(value)
  if (!p) return value ? String(value) : fallback
  return p.hasTime ? `${dayPart(p)} ${timePart(p)}` : dayPart(p)
}

/** 01:50 pm (India time). */
export function formatTime(value: DateValue, fallback = ''): string {
  const p = toParts(value)
  return p && p.hasTime ? timePart(p) : fallback
}

/** Today's date in India as YYYY-MM-DD, wherever the code runs. */
export function todayInIndia(): string {
  const p = toParts(new Date())!
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

/** The India calendar day (YYYY-MM-DD) of a timestamp, e.g. a created_at. */
export function dateInIndia(value: DateValue): string {
  const p = toParts(value)
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : ''
}

/** The 1st of the current month in India as YYYY-MM-DD. */
export function firstOfMonthInIndia(): string {
  return `${todayInIndia().slice(0, 8)}01`
}

/** A timestamp split into its India date (YYYY-MM-DD) and 24-hour time (HH:MM:SS). */
export function splitInIndia(value: DateValue): { date: string; time: string } {
  const p = toParts(value)
  if (!p || !p.hasTime) return { date: p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : '', time: '' }
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}` }
}
