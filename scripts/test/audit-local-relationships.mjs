#!/usr/bin/env node
// Audits the desktop build's local GraphQL engine (src/lib/localdb) against
// every GraphQL query/mutation written in src/. The desktop app (LOCAL_MODE)
// runs these through src/lib/localdb instead of Hasura, and that engine only
// knows the relationships listed in src/lib/localdb/relationships.ts — an
// unlisted relationship is silently missing from results (selection) or
// throws (where / order_by). Run after adding queries, before a desktop build.
//
// Usage: node scripts/test/audit-local-relationships.mjs
// (Node 22.6+ — imports the .ts files directly via type stripping.)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(root, 'package.json'))
const { parse, Kind } = require('graphql')
const { RELATIONSHIPS } = await import(pathToFileURL(join(root, 'src', 'lib', 'localdb', 'relationships.ts')).href)

const SCALAR_OPS = new Set(['_eq', '_neq', '_in', '_nin', '_is_null', '_gt', '_gte', '_lt', '_lte', '_like', '_ilike', '_nlike', '_nilike', '_similar', '_contains', '_has_key'])
const problems = new Set()

function tableOf(rootField) {
  return rootField.replace(/_by_pk$/, '').replace(/_aggregate$/, '').replace(/^(insert|update|delete)_/, '').replace(/_one$/, '')
}

// where / order_by literal: a key that isn't _and/_or/_not/an operator and whose
// value is an object of non-operators is a relationship on `table`.
function walkFilter(table, value, where) {
  if (!value || value.kind !== Kind.OBJECT) return
  for (const f of value.fields) {
    const key = f.name.value
    if (key === '_and' || key === '_or') {
      const items = f.value.kind === Kind.LIST ? f.value.values : [f.value]
      for (const v of items) walkFilter(table, v, where)
      continue
    }
    if (key === '_not') { walkFilter(table, f.value, where); continue }
    if (f.value.kind !== Kind.OBJECT) continue
    const isColumnOps = f.value.fields.every((x) => SCALAR_OPS.has(x.name.value))
    if (isColumnOps) continue
    const rel = RELATIONSHIPS[table]?.[key]
    if (!rel) { problems.add(`${table}.${key}  (used in ${where})`); continue }
    walkFilter(rel.table, f.value, where)
  }
}

function walkSelection(table, selectionSet, where) {
  for (const sel of selectionSet?.selections ?? []) {
    if (sel.kind !== Kind.FIELD) continue
    const name = sel.name.value
    for (const arg of sel.arguments ?? []) {
      if (arg.name.value === 'where' || arg.name.value === 'order_by') {
        const target = sel.selectionSet && name !== 'aggregate' && RELATIONSHIPS[table]?.[name] ? RELATIONSHIPS[table][name].table : table
        const vals = arg.value.kind === Kind.LIST ? arg.value.values : [arg.value]
        for (const v of vals) walkFilter(target, v, where)
      }
    }
    if (!sel.selectionSet || name === 'aggregate' || name === 'returning' || name === 'nodes') {
      if (name === 'nodes' || name === 'returning') walkSelection(table, sel.selectionSet, where)
      continue
    }
    const rel = RELATIONSHIPS[table]?.[name]
    if (!rel) { problems.add(`${table}.${name}  (selected in ${where})`); continue }
    walkSelection(rel.table, sel.selectionSet, where)
  }
}

function filesUnder(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'localdb' ? [] : filesUnder(p)
    return /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

let docs = 0
for (const file of filesUnder(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/`\s*((?:query|mutation)\b[\s\S]*?)`/g)) {
    // Template interpolations can't be parsed statically — blank them out.
    const src = m[1].replace(/\$\{[^}]*\}/g, '')
    let doc
    try { doc = parse(src) } catch { continue }
    docs++
    for (const def of doc.definitions) {
      if (def.kind !== Kind.OPERATION_DEFINITION) continue
      const opName = def.name?.value ?? '(anonymous)'
      for (const sel of def.selectionSet.selections) {
        if (sel.kind !== Kind.FIELD) continue
        const table = tableOf(sel.name.value)
        const where = `${opName} — ${file.slice(root.length + 1)}`
        for (const arg of sel.arguments ?? []) {
          if (arg.name.value === 'where' || arg.name.value === 'order_by') {
            const vals = arg.value.kind === Kind.LIST ? arg.value.values : [arg.value]
            for (const v of vals) walkFilter(table, v, where)
          }
        }
        walkSelection(table, sel.selectionSet, where)
      }
    }
  }
}

if (problems.size) {
  console.log(`${problems.size} relationship(s) used by the app but missing from src/lib/localdb/relationships.ts (checked ${docs} GraphQL documents):`)
  for (const p of [...problems].sort()) console.log('  ' + p)
  process.exit(1)
}
console.log(`OK — every relationship used in ${docs} GraphQL documents is known to the desktop query engine.`)
