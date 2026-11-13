#!/usr/bin/env node
// Builds the WareCore user guide (PowerPoint) from the same Help articles the
// app shows at /help (src/lib/help/articles.ts), with the screenshots from
// public/help/screens/. Ends with an alphabetical index with slide numbers.
//
// Usage: node scripts/help/build-user-guide.mjs [output.pptx]
// Needs: pptxgenjs (devDependency); react, react-dom, lucide-react and sharp are app deps.
// Optional: PPTX_APPLY_THEME=<path to apply_theme.js> also names the colours in the deck theme;
// on Windows with PowerPoint installed the steps are re-measured (see measure-steps.ps1).
// Screenshots: seed-demo.mjs + capture-screenshots.mjs (run those first when the UI changes).

import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = resolve(process.argv[2] ?? join(ROOT, 'WareCore-User-Guide.pptx'))
const SHOTS = join(ROOT, 'public', 'help', 'screens')

const pptxgen = require('pptxgenjs')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const sharp = require('sharp')
const lucide = require('lucide-react')
const { HELP_ARTICLES, HELP_CATEGORIES, HELP_BY_SLUG } = await import(pathToFileURL(join(ROOT, 'src', 'lib', 'help', 'articles.ts')).href)

// ── Theme ────────────────────────────────────────────────────────────────
const THEME = {
  name: 'WareCore',
  headFontFace: 'Calibri',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '1F2937', lt1: 'FFFFFF', dk2: '102239', lt2: 'EEF3FB',
    accent1: '265AD6', accent2: 'F59E0B', accent3: '0E9F6E', accent4: '7C3AED', accent5: 'DC2626', accent6: '0891B2',
    hlink: '265AD6', folHlink: '7C3AED',
  },
}
const HEX = { navy: '102239', blue: '265AD6', pale: 'EEF3FB', ink: '1F2937', muted: '6B7280', line: 'D1D5DB', amberBg: 'FEF6E4', amber: 'B45309', white: 'FFFFFF', ice: 'B9CCF5' }

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.333 x 7.5
pres.author = 'WareCore'
pres.company = 'WareCore'
pres.title = 'WareCore User Guide'
pres.subject = 'How to perform every activity in WareCore'
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace }
const SW = 13.333, SH = 7.5, M = 0.5

// ── Icons (lucide, rendered to PNG) ──────────────────────────────────────
const CATEGORY_ICON = {
  'Getting Started': 'Rocket', 'Master Data': 'Database', 'Purchases': 'ClipboardList', 'Stock & Transfers': 'Package',
  'Job Work': 'Factory', 'Sales': 'Receipt', 'Accounts': 'Wallet', 'Reports': 'ChartColumn',
  'Data Integrity': 'ShieldCheck', 'Administration': 'Settings',
}
const iconCache = new Map()
async function icon(name, color) {
  const key = name + color
  if (!iconCache.has(key)) {
    const svg = renderToStaticMarkup(React.createElement(lucide[name], { color: '#' + color, size: 256, strokeWidth: 1.75 }))
    const png = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer()
    iconCache.set(key, 'image/png;base64,' + png.toString('base64'))
  }
  return iconCache.get(key)
}

// ── Layouts ──────────────────────────────────────────────────────────────
const footer = (dark) => ({
  slideNumber: { x: SW - M - 0.8, y: SH - 0.42, w: 0.8, h: 0.3, fontFace: 'Calibri', fontSize: 10, color: dark ? HEX.ice : HEX.muted, align: 'right' },
})
pres.defineSlideMaster({
  title: 'WC Title',
  background: { color: HEX.navy },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: M + 0.1, y: 2.35, w: 7.9, h: 1.3, fontSize: 48, bold: true, color: HEX.white, valign: 'bottom', align: 'left', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: M + 0.1, y: 3.8, w: 7.6, h: 1.0, fontSize: 20, color: HEX.ice, valign: 'top', align: 'left', margin: 0 }, text: '' } },
  ],
})
pres.defineSlideMaster({
  title: 'WC Section',
  background: { color: HEX.navy },
  objects: [
    { text: { text: 'WareCore User Guide', options: { x: M, y: SH - 0.45, w: 5, h: 0.3, fontSize: 10, color: HEX.ice, margin: 0 } } },
    { placeholder: { options: { name: 'title', type: 'title', x: 1.95, y: 1.0, w: 10.5, h: 0.95, fontSize: 40, bold: true, color: HEX.white, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 1.95, y: 1.95, w: 10.5, h: 0.55, fontSize: 18, color: HEX.ice, valign: 'top', align: 'left', margin: 0 }, text: '' } },
  ],
  ...footer(true),
})
pres.defineSlideMaster({
  title: 'WC Content',
  background: { color: HEX.white },
  objects: [
    { text: { text: 'WareCore User Guide', options: { x: M, y: SH - 0.42, w: 5, h: 0.3, fontSize: 10, color: HEX.muted, margin: 0 } } },
    { placeholder: { options: { name: 'title', type: 'title', x: M, y: 0.3, w: 9.6, h: 0.8, fontSize: 32, bold: true, color: HEX.navy, valign: 'middle', align: 'left', margin: 0 }, text: '' } },
  ],
  ...footer(false),
})

// ── Text fitting (approximate Calibri metrics) ───────────────────────────
function lineCount(text, widthIn, pt) {
  const charW = (pt / 72) * 0.47 // average Calibri glyph ≈ 0.45em, plus a little slack
  const perLine = Math.max(8, Math.floor(widthIn / charW))
  let lines = 1, cur = 0
  for (const word of text.split(/\s+/)) {
    const len = word.length + (cur ? 1 : 0)
    if (cur + len > perLine) { lines++; cur = word.length } else cur += len
  }
  return lines
}
const lineH = (pt) => (pt * 1.2) / 72

let slideNo = 0
const addSlide = (masterName, sectionTitle) => { slideNo++; return pres.addSlide({ masterName, sectionTitle }) }

function circleNum(slide, n, x, y, d, fill, color, pt) {
  slide.addText(String(n), { shape: pres.shapes.OVAL, x, y, w: d, h: d, fill: { color: fill }, line: { color: fill }, fontSize: pt, bold: true, color, align: 'center', valign: 'middle', margin: 0, objectName: `stepDot-${n}` })
}

function chip(slide, text, x, y, opts = {}) {
  const pt = opts.pt ?? 12
  const w = Math.max(1.0, text.length * (pt / 72) * 0.55 + 0.4)
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: opts.right ? x - w : x, y, w, h: 0.34, rectRadius: 0.17, fill: { color: opts.fill ?? HEX.pale }, line: { color: opts.fill ?? HEX.pale }, objectName: 'Category chip' })
  slide.addText(text, { x: opts.right ? x - w : x, y, w, h: 0.34, fontSize: pt, bold: true, color: opts.color ?? HEX.blue, align: 'center', valign: 'middle', margin: 0, isTextBox: true })
  return w
}

// ── Slide builders ───────────────────────────────────────────────────────
const sectionStart = {}
const articleSlide = {}

function titleSlide() {
  pres.addSection({ title: 'Introduction' })
  const s = addSlide('WC Title', 'Introduction')
  s.addText('WareCore User Guide', { placeholder: 'title' })
  s.addText('How to perform every activity, step by step, with screenshots', { placeholder: 'body' })
  s.addText(`${HELP_ARTICLES.length} guides  ·  Alphabetical index at the end  ·  ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`, {
    x: M + 0.1, y: SH - 1.1, w: 8, h: 0.4, fontSize: 14, color: HEX.ice, margin: 0, isTextBox: true,
  })
  const dash = join(SHOTS, 'dashboard.jpg')
  if (existsSync(dash)) {
    s.addImage({ path: dash, x: 8.6, y: 1.2, w: 6.4, h: 4.0, rotate: -4, altText: 'WareCore dashboard', shadow: { type: 'outer', color: '000000', opacity: 0.45, blur: 18, offset: 6, angle: 90 } })
  }
  return s
}

async function contentsSlide(sectionsPlan) {
  const s = addSlide('WC Content', 'Introduction')
  s.addText('What is in this guide', { placeholder: 'title' })
  s.addText('Each section starts with a divider. Every activity has its own slide: a screenshot, numbered steps and tips. The alphabetical index is at the end.', {
    x: M, y: 1.15, w: 12.3, h: 0.5, fontSize: 15, color: HEX.muted, margin: 0, isTextBox: true,
  })
  const cols = 2, cardW = 6.0, cardH = 0.84, gapX = 0.33, gapY = 0.14, top = 1.85
  for (let i = 0; i < sectionsPlan.length; i++) {
    const p = sectionsPlan[i]
    const col = i % cols, row = Math.floor(i / cols)
    const x = M + col * (cardW + gapX), y = top + row * (cardH + gapY)
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: cardW, h: cardH, rectRadius: 0.1, fill: { color: HEX.pale }, line: { color: HEX.pale }, objectName: `${p.name} card` })
    s.addShape(pres.shapes.OVAL, { x: x + 0.18, y: y + 0.15, w: 0.54, h: 0.54, fill: { color: HEX.blue }, line: { color: HEX.blue }, objectName: `${p.name} icon circle` })
    s.addImage({ data: await icon(CATEGORY_ICON[p.name], 'FFFFFF'), x: x + 0.3, y: y + 0.27, w: 0.3, h: 0.3, altText: '' })
    s.addText([
      { text: p.name, options: { bold: true, fontSize: 16, color: HEX.navy, breakLine: true } },
      { text: `${p.count} guide${p.count === 1 ? '' : 's'}`, options: { fontSize: 12, color: HEX.muted } },
    ], { x: x + 0.9, y: y + 0.08, w: 3.9, h: cardH - 0.16, valign: 'middle', margin: 0, isTextBox: true })
    s.addText(`Slide ${p.slide}`, { x: x + cardW - 1.3, y, w: 1.15, h: cardH, fontSize: 14, bold: true, color: HEX.blue, align: 'right', valign: 'middle', margin: 0, isTextBox: true })
  }
  s.addNotes('Contents: the guide is organised by module, in the same order as the in-app Help (Help & How-To in the left menu).')
}

async function overviewSlide() {
  const s = addSlide('WC Content', 'Introduction')
  s.addText('How stock flows through WareCore', { placeholder: 'title' })
  s.addText('Every document posts to one stock ledger. Reports and Data Integrity read that ledger.', {
    x: M, y: 1.15, w: 12.3, h: 0.45, fontSize: 15, color: HEX.muted, margin: 0, isTextBox: true,
  })
  const box = async (label, sub, iconName, x, y, w = 2.55, fill = HEX.pale, txt = HEX.navy) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 1.25, rectRadius: 0.12, fill: { color: fill }, line: { color: fill }, shadow: { type: 'outer', color: '000000', opacity: 0.12, blur: 6, offset: 2, angle: 90 }, objectName: `${label} box` })
    s.addImage({ data: await icon(iconName, fill === HEX.pale ? HEX.blue : 'FFFFFF'), x: x + 0.2, y: y + 0.22, w: 0.42, h: 0.42, altText: '' })
    s.addText([
      { text: label, options: { bold: true, fontSize: 16, color: txt, breakLine: true } },
      { text: sub, options: { fontSize: 12, color: fill === HEX.pale ? HEX.muted : HEX.ice } },
    ], { x: x + 0.75, y: y + 0.12, w: w - 0.85, h: 1.0, valign: 'middle', margin: 0, isTextBox: true })
  }
  const arrow = (x1, y1, x2, y2) => s.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 0.001, h: Math.abs(y2 - y1) || 0.001, flipH: x2 < x1, flipV: y2 < y1, line: { color: HEX.blue, width: 2, endArrowType: 'triangle' }, objectName: 'Flow arrow' })
  const y1 = 1.95, y2 = 3.75
  await box('Purchase Entry', 'Bills add stock', 'ClipboardList', 0.5, y1)
  await box('Warehouse stock', 'By company & warehouse', 'Package', 3.65, y1)
  await box('Sale Entry', 'Sales remove stock', 'Receipt', 6.8, y1)
  await box('Customer returns', 'Bring stock back', 'PackageOpen', 9.95, y1, 2.88)
  await box('Transfers', 'Between warehouses', 'ArrowLeftRight', 0.5, y2)
  await box('Job Work', 'Material at vendors', 'Factory', 3.65, y2)
  await box('Vendor transfers', 'Vendor to vendor', 'Shuffle', 6.8, y2)
  await box('Sell from vendor', 'Direct from job work', 'Truck', 9.95, y2, 2.88)
  arrow(3.05, y1 + 0.62, 3.65, y1 + 0.62)
  arrow(6.2, y1 + 0.62, 6.8, y1 + 0.62)
  arrow(9.35, y1 + 0.62, 9.95, y1 + 0.62)
  arrow(3.05, y2 + 0.62, 3.65, y1 + 1.0)
  arrow(4.92, y1 + 1.25, 4.92, y2)
  arrow(6.2, y2 + 0.62, 6.8, y2 + 0.62)
  arrow(9.35, y2 + 0.62, 9.95, y2 + 0.62)
  // Ledger band
  const ly = 5.4
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.5, y: ly, w: 12.33, h: 1.05, rectRadius: 0.12, fill: { color: HEX.navy }, line: { color: HEX.navy }, objectName: 'Stock ledger band' })
  s.addImage({ data: await icon('BookOpen', 'FFFFFF'), x: 0.75, y: ly + 0.29, w: 0.46, h: 0.46, altText: '' })
  s.addText([
    { text: 'Stock ledger', options: { bold: true, fontSize: 18, color: 'FFFFFF', breakLine: true } },
    { text: 'One row per movement, posted once per document line', options: { fontSize: 13, color: HEX.ice } },
  ], { x: 1.4, y: ly + 0.08, w: 5.6, h: 0.9, valign: 'middle', margin: 0, isTextBox: true })
  s.addText([
    { text: 'Read by: ', options: { bold: true, color: 'FFFFFF' } },
    { text: 'Inventory · Movements · 12 Reports · Data Integrity checks', options: { color: HEX.ice } },
  ], { x: 7.0, y: ly + 0.08, w: 5.6, h: 0.9, fontSize: 14, valign: 'middle', align: 'right', margin: 0, isTextBox: true })
  s.addNotes('Overview of how documents move stock. Purchases add stock, sales remove it, returns bring it back. Job work sends material to vendors and brings output back. Everything posts to one stock ledger, which all reports read.')
}

async function sectionSlide(cat, items) {
  pres.addSection({ title: cat.name })
  const s = addSlide('WC Section', cat.name)
  sectionStart[cat.name] = slideNo
  s.addShape(pres.shapes.OVAL, { x: M, y: 1.0, w: 1.1, h: 1.1, fill: { color: HEX.blue }, line: { color: HEX.blue }, objectName: 'Section icon circle' })
  s.addImage({ data: await icon(CATEGORY_ICON[cat.name], 'FFFFFF'), x: M + 0.27, y: 1.27, w: 0.56, h: 0.56, altText: '' })
  s.addText(cat.name, { placeholder: 'title' })
  s.addText(cat.blurb, { placeholder: 'body' })
  // List of guides in this section with their slide numbers.
  const half = Math.ceil(items.length / 2)
  const cols = items.length > 6 ? [items.slice(0, half), items.slice(half)] : [items]
  cols.forEach((list, ci) => {
    list.forEach((a, i) => {
      const x = 1.95 + ci * 5.4, y = 2.95 + i * 0.5
      s.addText([
        { text: String(articleSlide[a.slug]).padStart(2, ' '), options: { bold: true, color: HEX.ice } },
        { text: '   ' + a.title, options: { color: 'FFFFFF' } },
      ], { x, y, w: 5.2, h: 0.42, fontSize: 16, valign: 'middle', margin: 0, isTextBox: true })
    })
  })
  s.addNotes(`${cat.name}: ${cat.blurb}.`)
}

async function articleSlideFor(a, cat) {
  const s = addSlide('WC Content', cat.name)
  s.addText(a.title, { placeholder: 'title' })
  chip(s, a.category, SW - M, 0.53, { right: true })
  const shot = join(SHOTS, `${a.slug}.jpg`)
  const hasShot = a.screenshot !== false && existsSync(shot)

  const stepsText = a.steps
  const pt = 14
  if (hasShot) {
    // Choose the widest screenshot that leaves the step column room to fit.
    const top = 1.3, bottom = SH - 0.6
    let shotW, colX, colW, heights
    for (shotW of [7.4, 7.0, 6.6, 6.2]) {
      colX = M + shotW + 0.35
      colW = SW - M - colX
      const textW = colW - 0.5
      heights = stepsText.map((t) => lineCount(t, textW, pt) * lineH(pt))
      const total = lineCount(a.summary, colW, 15) * lineH(15) + 0.25 + heights.reduce((x, y) => x + y + 0.14, 0) + 0.55
      if (top + total <= bottom) break
    }
    const shotH = shotW / 1.6
    s.addImage({ path: shot, x: M, y: top, w: shotW, h: shotH, altText: `Screenshot: ${a.pathLabel}`, shadow: { type: 'outer', color: '000000', opacity: 0.18, blur: 8, offset: 2, angle: 90 } })
    s.addShape(pres.shapes.RECTANGLE, { x: M, y: top, w: shotW, h: shotH, fill: { type: 'none' }, line: { color: HEX.line, width: 0.75 }, objectName: 'Screenshot frame' })

    // Below the screenshot: tips, or where to find it.
    const by = top + shotH + 0.22
    const bh = bottom - by
    if (a.tips?.length) {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: M, y: by, w: shotW, h: bh, rectRadius: 0.08, fill: { color: HEX.amberBg }, line: { color: HEX.amberBg }, objectName: 'Tips box' })
      s.addImage({ data: await icon('Lightbulb', HEX.amber), x: M + 0.15, y: by + 0.14, w: 0.28, h: 0.28, altText: '' })
      const tipPt = a.tips.join(' ').length > 190 ? 11 : 12
      s.addText(a.tips.map((t, i) => ({ text: t, options: { bullet: a.tips.length > 1, breakLine: i < a.tips.length - 1, paraSpaceAfter: 2 } })), {
        x: M + 0.55, y: by + 0.06, w: shotW - 0.7, h: bh - 0.12, fontSize: tipPt, color: '7C2D12', valign: 'middle', margin: 0, isTextBox: true,
      })
    } else {
      const rel = (a.related ?? []).map((r) => HELP_BY_SLUG[r]).filter(Boolean)
      s.addText([
        { text: 'See also: ', options: { bold: true, color: HEX.navy } },
        { text: rel.length ? rel.map((r) => `${r.title} (slide ${articleSlide[r.slug] ?? '–'})`).join('  ·  ') : a.pathLabel, options: { color: HEX.muted } },
      ], { x: M, y: by, w: shotW, h: bh, fontSize: 12, valign: 'middle', margin: 0, isTextBox: true })
    }

    // Step column
    let y = top
    const sumH = lineCount(a.summary, colW, 15) * lineH(15)
    s.addText(a.summary, { x: colX, y, w: colW, h: sumH, fontSize: 15, italic: true, color: HEX.muted, margin: 0, valign: 'top', isTextBox: true, objectName: 'summary' })
    y += sumH + 0.25
    stepsText.forEach((t, i) => {
      circleNum(s, i + 1, colX, y + 0.01, 0.32, HEX.blue, 'FFFFFF', 12)
      s.addText(t, { x: colX + 0.45, y, w: colW - 0.45, h: heights[i] + 0.04, fontSize: pt, color: HEX.ink, margin: 0, valign: 'top', isTextBox: true, objectName: `stepText-${i + 1}` })
      y += heights[i] + 0.14
    })
    // Where to find it
    s.addText([
      { text: 'Open: ', options: { bold: true, color: HEX.navy } },
      { text: a.pathLabel, options: { color: HEX.blue, bold: true } },
      ...(a.path !== '/login' ? [{ text: `   ${a.path}`, options: { color: HEX.muted, fontSize: 11 } }] : []),
    ], { x: colX, y: bottom - 0.36, w: colW, h: 0.36, fontSize: 13, valign: 'bottom', margin: 0, isTextBox: true })
  } else {
    // No screenshot: steps on the left, reference cards on the right.
    const top = 1.3, leftW = 7.6, x2 = M + leftW + 0.45, w2 = SW - M - x2
    s.addText(a.summary, { x: M, y: top, w: leftW, h: 0.55, fontSize: 16, italic: true, color: HEX.muted, margin: 0, valign: 'top', isTextBox: true, objectName: 'summary' })
    let y = top + 0.8
    const spt = 16
    a.steps.forEach((t, i) => {
      const h = lineCount(t, leftW - 0.6, spt) * lineH(spt)
      circleNum(s, i + 1, M, y, 0.4, HEX.blue, 'FFFFFF', 14)
      s.addText(t, { x: M + 0.6, y: y + 0.02, w: leftW - 0.6, h: h + 0.05, fontSize: spt, color: HEX.ink, margin: 0, valign: 'top', isTextBox: true, objectName: `stepText-${i + 1}` })
      y += Math.max(h, 0.4) + 0.22
    })
    let cy = top
    const card = async (title, iconName, body, fill, color, h) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x2, y: cy, w: w2, h, rectRadius: 0.1, fill: { color: fill }, line: { color: fill }, objectName: `${title} card` })
      s.addImage({ data: await icon(iconName, color), x: x2 + 0.2, y: cy + 0.2, w: 0.32, h: 0.32, altText: '' })
      s.addText(title, { x: x2 + 0.65, y: cy + 0.15, w: w2 - 0.8, h: 0.42, fontSize: 15, bold: true, color, margin: 0, valign: 'middle', isTextBox: true })
      s.addText(body, { x: x2 + 0.25, y: cy + 0.65, w: w2 - 0.45, h: h - 0.8, fontSize: 13, color: HEX.ink, margin: 0, valign: 'top', isTextBox: true })
      cy += h + 0.25
    }
    await card('Where', 'MapPin', [{ text: a.pathLabel, options: { bold: true, color: HEX.blue, breakLine: true } }, { text: a.path, options: { color: HEX.muted, fontSize: 12 } }], HEX.pale, HEX.navy, 1.4)
    if (a.tips?.length) await card('Good to know', 'Lightbulb', a.tips.map((t, i) => ({ text: t, options: { bullet: a.tips.length > 1, breakLine: i < a.tips.length - 1 } })), HEX.amberBg, HEX.amber, 1.75)
    const rel = (a.related ?? []).map((r) => HELP_BY_SLUG[r]).filter(Boolean)
    if (rel.length) await card('Related', 'Link', rel.map((r, i) => ({ text: `${r.title}  (slide ${articleSlide[r.slug] ?? '–'})`, options: { breakLine: i < rel.length - 1 } })), HEX.pale, HEX.navy, 0.75 + rel.length * 0.3)
  }
  s.addNotes(`${a.summary}\n\nSteps:\n${a.steps.map((t, i) => `${i + 1}. ${t}`).join('\n')}${a.tips?.length ? `\n\nGood to know:\n- ${a.tips.join('\n- ')}` : ''}\n\nIn the app: Help & How-To → "${a.title}".`)
}

// Search words too vague to be useful in a printed index.
const INDEX_SKIP = new Set(['in out', 'home', 'links', 'value', 'type', 'history', 'summary', 'check', 'status', 'staff', 'entity',
  'firm', 'business', 'client', 'buyer', 'seller', 'money', 'question', 'assistant', 'chat', 'overview', 'view', 'access', 'rights',
  'security', 'account', 'navigate', 'menu', 'search', 'shortcut', 'preview', 'configuration', 'settings', 'setup', 'masters',
  'documentation', 'manual', 'guide', 'how to', 'mistake', 'correct', 'modify', 'complete', 'receive', 'produced', 'pending',
  'transactions', 'entries', 'collection', 'location', 'store', 'yard', 'audit', 'errors', 'check', 'scan', 'activity', 'branch',
  'transfer list', 'transfers', 'users', 'user', 'role', 'company', 'item', 'customer', 'supplier', 'sale', 'stock', 'purchase',
  'jobwork', 'export', 'download data', 'removed entries', 'deleted', 'archive', 'cancelled bills', 'cancelled sales', 'invoice',
  'material', 'unit', 'size', 'grade', 'width', 'thickness', 'quantity', 'balance', 'version', 'plan', 'hosting', 'limits', 'mis',
  'pdf', 'print', 'excel', 'csv', 'xlsx', 'upload', 'template', 'batch', 'bulk', 'id', 'line id', 'ctrl k', 'emp', 'employee'])
const ACRONYMS = { gst: 'GST', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', tds: 'TDS', tcs: 'TCS', grn: 'GRN', sku: 'SKU', fy: 'FY', ai: 'AI', upi: 'UPI', gstin: 'GSTIN' }
function prettyTerm(t) {
  return t.split(' ').map((w, i) => ACRONYMS[w.toLowerCase()] ?? (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}
function indexEntries() {
  const map = new Map()
  const add = (term, slug) => {
    const t = term.trim()
    if (!t || INDEX_SKIP.has(t.toLowerCase())) return
    const key = t.toLowerCase()
    if (!map.has(key)) map.set(key, { term: prettyTerm(t), slides: new Set() })
    map.get(key).slides.add(articleSlide[slug])
  }
  for (const a of HELP_ARTICLES) {
    add(a.title, a.slug)
    add(a.pathLabel, a.slug)
    for (const k of a.keywords ?? []) if (k.length > 1) add(k, a.slug)
  }
  for (const c of HELP_CATEGORIES) {
    if (!map.has(c.name.toLowerCase())) map.set(c.name.toLowerCase(), { term: c.name, slides: new Set() })
    map.get(c.name.toLowerCase()).slides.add(sectionStart[c.name])
  }
  return [...map.values()]
    .map((e) => ({ term: e.term, slides: [...e.slides].filter(Boolean).sort((x, y) => x - y) }))
    .sort((x, y) => x.term.localeCompare(y.term, 'en', { sensitivity: 'base' }))
}

function indexSlides() {
  pres.addSection({ title: 'Index' })
  const entries = indexEntries()
  // Flow letters and entries into 4 columns per slide.
  const rows = []
  let letter = ''
  for (const e of entries) {
    const l = /[a-z]/i.test(e.term[0]) ? e.term[0].toUpperCase() : '#'
    if (l !== letter) { rows.push({ head: l }); letter = l }
    rows.push(e)
  }
  const COLS = 4, ROWS = 26, colW = (SW - 2 * M - (COLS - 1) * 0.3) / COLS, rowH = 0.208, top = 1.2
  // Fill column by column; never leave a letter heading alone at the foot of a column.
  // Capacity is counted in printed lines: a long term wraps onto two.
  const linesOf = (r) => (r.head ? 1 : lineCount(`${r.term}  ${r.slides.join(', ')}`, colW - 0.05, 11))
  const columns = []
  let cur = [], used = 0
  for (const r of rows) {
    const n = linesOf(r)
    if (used + n > ROWS || (r.head && used + n >= ROWS)) { columns.push(cur); cur = []; used = 0 }
    cur.push(r)
    used += n
  }
  if (cur.length) columns.push(cur)
  const pages = []
  for (let i = 0; i < columns.length; i += COLS) pages.push(columns.slice(i, i + COLS))
  pages.forEach((chunk, p) => {
    const s = addSlide('WC Content', 'Index')
    s.addText(p === 0 ? 'Index A–Z' : 'Index A–Z (continued)', { placeholder: 'title' })
    s.addText('Slide numbers', { x: SW - M - 3, y: 0.5, w: 3, h: 0.4, fontSize: 12, color: HEX.muted, align: 'right', margin: 0, isTextBox: true })
    for (let c = 0; c < chunk.length; c++) {
      const col = chunk[c]
      const runs = []
      col.forEach((r, i) => {
        if (r.head) runs.push({ text: r.head, options: { bold: true, fontSize: 13, color: HEX.blue, breakLine: i < col.length - 1 } })
        else {
          runs.push({ text: r.term, options: { fontSize: 11, color: HEX.ink } })
          runs.push({ text: '  ' + r.slides.join(', '), options: { fontSize: 11, bold: true, color: HEX.blue, breakLine: i < col.length - 1 } })
        }
      })
      s.addText(runs, { x: M + c * (colW + 0.3), y: top, w: colW, h: ROWS * rowH + 0.1, valign: 'top', margin: 0, lineSpacing: 15, isTextBox: true })
    }
    s.addNotes('Alphabetical index: guide titles, screen names and common search words, with the slide numbers where they are explained. The same guides can be searched inside WareCore under Help & How-To.')
  })
  return pages.length
}

// ── Plan slide numbers first (index needs them), then build ──────────────
const cats = HELP_CATEGORIES.map((c) => ({ ...c, items: HELP_ARTICLES.filter((a) => a.category === c.name) })).filter((c) => c.items.length)
{
  let n = 3 // title, contents, overview
  for (const c of cats) {
    n++ // section divider
    for (const a of c.items) articleSlide[a.slug] = ++n
  }
}
titleSlide()
const plan = []
{
  let n = 3
  for (const c of cats) { plan.push({ name: c.name, count: c.items.length, slide: n + 1 }); n += 1 + c.items.length }
}
await contentsSlide(plan)
await overviewSlide()
for (const c of cats) {
  await sectionSlide(c, c.items)
  for (const a of c.items) {
    await articleSlideFor(a, c)
    if (articleSlide[a.slug] !== slideNo) throw new Error(`slide plan drifted at ${a.slug}`)
  }
}
const indexPages = indexSlides()

await pres.writeFile({ fileName: OUT })

// Even out the numbered steps: the layout above can only estimate how tall a
// wrapped step is. On Windows with PowerPoint installed, measure the real
// heights (read-only, nothing saved) and move the boxes in the file directly.
async function relayoutSteps(file) {
  if (process.platform !== 'win32' || process.env.NO_RELAYOUT) return 'skipped'
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'scripts', 'help', 'measure-steps.ps1'), '-Pptx', file], { encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) return `skipped (${(r.stderr || r.stdout).trim().split(/\r?\n/)[0]})`
  const moves = JSON.parse(r.stdout.trim())
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(readFileSync(file))
  const EMU = 12700
  const bySlide = new Map()
  for (const m of moves) bySlide.set(m.slide, [...(bySlide.get(m.slide) ?? []), m])
  for (const [n, list] of bySlide) {
    const path = `ppt/slides/slide${n}.xml`
    let xml = await zip.file(path).async('string')
    for (const m of list) {
      xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
        if (!sp.includes(`name="${m.name}"`)) return sp
        return sp
          .replace(/(<a:off x="\d+" y=")\d+(")/, `$1${Math.round(m.top * EMU)}$2`)
          .replace(/(<a:ext cx="\d+" cy=")\d+(")/, `$1${Math.round(m.height * EMU)}$2`)
      })
    }
    zip.file(path, xml)
  }
  // Re-zipping adds folder entries, which some cloud viewers refuse; drop them.
  for (const name of Object.keys(zip.files)) if (zip.files[name].dir) delete zip.files[name]
  writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  return `${moves.length} boxes`
}

// apply_theme.js comes with the pptx tooling; point PPTX_APPLY_THEME at it to write the theme colours.
const themeMod = process.env.PPTX_APPLY_THEME ? require(process.env.PPTX_APPLY_THEME) : null
const applyTheme = themeMod?.applyTheme ?? null
if (applyTheme) await applyTheme(OUT, THEME)
const relaid = await relayoutSteps(OUT)
console.log(`Wrote ${OUT}: ${slideNo} slides (${HELP_ARTICLES.length} guides, index on slides ${slideNo - indexPages + 1}–${slideNo}); steps re-measured: ${relaid}${applyTheme ? '' : '; theme colours not applied (set PPTX_APPLY_THEME)'}`)
