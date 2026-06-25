import { RELATIONSHIPS } from './relationships'

/**
 * Translates a Hasura bool_exp object into a SQL WHERE fragment, appending
 * values to `params` and returning placeholders ($1, $2, ...) for them.
 * Supports only the operators actually used in src/lib/hasura/queries.ts:
 * _eq, _neq, _in, _is_null, _or, _not, plus relationship filters (resolved
 * as EXISTS subqueries via the relationship map).
 */
export function buildWhere(table: string, boolExp: unknown, params: unknown[], alias = table): string {
  if (!boolExp || typeof boolExp !== 'object') return 'TRUE'
  const entries = Object.entries(boolExp as Record<string, unknown>)
  if (entries.length === 0) return 'TRUE'

  const clauses = entries.map(([key, value]) => {
    if (key === '_or') {
      const parts = (value as unknown[]).map((v) => buildWhere(table, v, params, alias))
      return parts.length ? `(${parts.join(' OR ')})` : 'TRUE'
    }
    if (key === '_and') {
      const parts = (value as unknown[]).map((v) => buildWhere(table, v, params, alias))
      return parts.length ? `(${parts.join(' AND ')})` : 'TRUE'
    }
    if (key === '_not') {
      return `NOT (${buildWhere(table, value, params, alias)})`
    }

    const rel = RELATIONSHIPS[table]?.[key]
    if (rel) {
      const subAlias = `${alias}_${key}`
      if (rel.kind === 'object') {
        const sub = buildWhere(rel.table, value, params, subAlias)
        return `EXISTS (SELECT 1 FROM "${rel.table}" "${subAlias}" WHERE "${subAlias}".id = "${alias}"."${rel.localKey}" AND ${sub})`
      }
      const sub = buildWhere(rel.table, value, params, subAlias)
      return `EXISTS (SELECT 1 FROM "${rel.table}" "${subAlias}" WHERE "${subAlias}"."${rel.foreignKey}" = "${alias}".id AND ${sub})`
    }

    // Plain column — value is an operator object, e.g. { _eq: 'x' } or { _in: [...] }
    const ops = Object.entries(value as Record<string, unknown>).map(([op, opVal]) => {
      // Hasura's magic "now()" timestamp literal — emit SQL NOW() instead of binding it as a value.
      const rhs = () => {
        if (opVal === 'now()') return 'NOW()'
        params.push(opVal)
        return `$${params.length}`
      }
      switch (op) {
        case '_eq':
          return `"${alias}"."${key}" = ${rhs()}`
        case '_neq':
          return `"${alias}"."${key}" != ${rhs()}`
        case '_gt':
          return `"${alias}"."${key}" > ${rhs()}`
        case '_gte':
          return `"${alias}"."${key}" >= ${rhs()}`
        case '_lt':
          return `"${alias}"."${key}" < ${rhs()}`
        case '_lte':
          return `"${alias}"."${key}" <= ${rhs()}`
        case '_in':
          params.push(opVal)
          return `"${alias}"."${key}" = ANY($${params.length})`
        case '_nin':
          params.push(opVal)
          return `"${alias}"."${key}" != ALL($${params.length})`
        case '_is_null':
          return opVal ? `"${alias}"."${key}" IS NULL` : `"${alias}"."${key}" IS NOT NULL`
        default:
          throw new Error(`Unsupported where operator "${op}" on column "${key}"`)
      }
    })
    return ops.length ? `(${ops.join(' AND ')})` : 'TRUE'
  })

  return clauses.length ? clauses.join(' AND ') : 'TRUE'
}
