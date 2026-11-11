#!/usr/bin/env node
// Lists every GraphQL feature the app's queries/mutations use, so gaps in the
// direct-Postgres engine (src/lib/localdb — used by the desktop build and by
// the web app when DIRECT_DB=true) can be spotted before a screen breaks.
// Companion to audit-local-relationships.mjs, which checks relationships only.
//
// Usage: node scripts/test/audit-local-graphql-features.mjs [--verbose]
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(root, 'package.json'))
const { parse, Kind } = require('graphql')
const verbose = process.argv.includes('--verbose')

const features = new Map() // feature -> Set(where)
const note = (feature, where) => {
  if (!features.has(feature)) features.set(feature, new Set())
  features.get(feature).add(where)
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'localdb' ? [] : filesUnder(p)
    return /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

function walkFilter(value, where) {
  if (!value) return
  if (value.kind === Kind.VARIABLE) return note('where: passed as a whole variable', where)
  if (value.kind === Kind.LIST) return value.values.forEach((v) => walkFilter(v, where))
  if (value.kind !== Kind.OBJECT) return
  for (const f of value.fields) {
    const key = f.name.value
    if (key.startsWith('_')) {
      note(`where op ${key}`, where)
      if (['_and', '_or', '_not'].includes(key)) walkFilter(f.value, where)
      continue
    }
    walkFilter(f.value, where)
  }
}

function walkOrder(value, where) {
  if (!value) return
  if (value.kind === Kind.VARIABLE) return note('order_by: passed as a whole variable', where)
  if (value.kind === Kind.LIST) return value.values.forEach((v) => walkOrder(v, where))
  if (value.kind === Kind.ENUM) return note(`order_by dir ${value.value}`, where)
  if (value.kind === Kind.OBJECT) value.fields.forEach((f) => walkOrder(f.value, where))
}

function walkArgs(field, level, where) {
  for (const arg of field.arguments ?? []) {
    const a = arg.name.value
    note(`${level} arg ${a}`, where)
    if (a === 'where') walkFilter(arg.value, where)
    if (a === 'order_by') walkOrder(arg.value, where)
    if (a === 'objects' || a === 'object') {
      // Nested insert: an object value whose field value is { data: ... }
      const objs = arg.value.kind === Kind.LIST ? arg.value.values : [arg.value]
      for (const o of objs) {
        if (o.kind === Kind.VARIABLE) { note(`insert ${a}: passed as variable`, where); continue }
        if (o.kind !== Kind.OBJECT) continue
        for (const f of o.fields) {
          if (f.value.kind === Kind.OBJECT && f.value.fields.some((x) => x.name.value === 'data')) note('NESTED INSERT', where)
        }
      }
    }
  }
}

function walkSelection(selectionSet, depth, where) {
  for (const sel of selectionSet?.selections ?? []) {
    if (sel.kind === Kind.FRAGMENT_SPREAD || sel.kind === Kind.INLINE_FRAGMENT) { note('FRAGMENT', where); continue }
    if (sel.kind !== Kind.FIELD) continue
    const name = sel.name.value
    if (depth > 0 && /_aggregate$/.test(name)) note('NESTED _aggregate', where)
    if (name === 'aggregate') {
      for (const s of sel.selectionSet?.selections ?? []) note(`aggregate fn ${s.name.value}`, where)
      continue
    }
    if (depth > 0 && sel.arguments?.length && name !== 'returning') walkArgs(sel, 'nested', where)
    if (sel.selectionSet) walkSelection(sel.selectionSet, depth + 1, where)
  }
}

let docs = 0
for (const file of filesUnder(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/`\s*((?:query|mutation|subscription)\b[\s\S]*?)`/g)) {
    const raw = m[1]
    if (/\$\{/.test(raw)) note('TEMPLATE INTERPOLATION (dynamic doc)', file.slice(root.length + 1))
    let doc
    try { doc = parse(raw.replace(/\$\{[^}]*\}/g, '')) } catch { continue }
    docs++
    for (const def of doc.definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) { note('FRAGMENT', file); continue }
      if (def.kind !== Kind.OPERATION_DEFINITION) continue
      const where = `${def.name?.value ?? '(anon)'} — ${file.slice(root.length + 1)}`
      if (def.operation === 'subscription') note('SUBSCRIPTION', where)
      const roots = def.selectionSet.selections.filter((s) => s.kind === Kind.FIELD)
      if (def.operation === 'mutation' && roots.length > 1) note(`MULTI-ROOT MUTATION (${roots.length})`, where)
      for (const r of roots) {
        const n = r.name.value
        const kind =
          /^insert_\w+_one$/.test(n) ? 'insert_one' : /^insert_/.test(n) ? 'insert' :
          /^update_\w+_by_pk$/.test(n) ? 'update_by_pk' : /^update_\w+_many$/.test(n) ? 'update_many' : /^update_/.test(n) ? 'update' :
          /^delete_\w+_by_pk$/.test(n) ? 'delete_by_pk' : /^delete_/.test(n) ? 'delete' :
          /_aggregate$/.test(n) ? 'select_aggregate' : /_by_pk$/.test(n) ? 'select_by_pk' : 'select'
        note(`root ${def.operation} ${kind}`, where)
        walkArgs(r, 'root', where)
        for (const arg of r.arguments ?? []) if (/^_(inc|append|prepend|delete_key|delete_elem|delete_at_path)$/.test(arg.name.value)) note(`UPDATE OP ${arg.name.value}`, where)
        walkSelection(r.selectionSet, 1, where)
      }
    }
  }
}

console.log(`Scanned ${docs} GraphQL documents.\n`)
for (const [f, wheres] of [...features.entries()].sort()) {
  console.log(`${String(wheres.size).padStart(4)}  ${f}`)
  if (verbose || /^[A-Z]/.test(f)) for (const w of [...wheres].slice(0, 12)) console.log(`        ${w}`)
}
