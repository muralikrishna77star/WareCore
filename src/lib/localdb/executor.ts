import { DocumentNode, FieldNode, OperationDefinitionNode, parse, valueFromASTUntyped } from 'graphql'
import { evalArgs, fieldSelections, resultKey } from './ast'
import { selectMany, selectByPk, selectAggregate } from './compile-select'
import { insertOne, insertMany } from './compile-insert'
import { updateByPk, updateMany } from './compile-update'
import { deleteByPk, deleteMany } from './compile-delete'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface GraphQLEnvelope<T = any> {
  data: T | null
  errors?: { message: string }[]
}

/**
 * Local Postgres equivalent of a Hasura GraphQL request — parses the document,
 * dispatches each root field to the matching compiler, and returns the same
 * { data, errors } envelope a real Hasura response would.
 */
export async function executeGraphQL<T = any>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<GraphQLEnvelope<T>> {
  try {
    const doc: DocumentNode = parse(query)
    const operation = doc.definitions.find((d): d is OperationDefinitionNode => d.kind === 'OperationDefinition')
    if (!operation) throw new Error('No operation found in GraphQL document')

    const mergedVariables: Record<string, unknown> = { ...variables }
    for (const varDef of operation.variableDefinitions ?? []) {
      const name = varDef.variable.name.value
      if (mergedVariables[name] === undefined && varDef.defaultValue) {
        mergedVariables[name] = valueFromASTUntyped(varDef.defaultValue, {})
      }
    }

    const data: Record<string, unknown> = {}
    for (const field of fieldSelections(operation.selectionSet)) {
      const args = evalArgs(field, mergedVariables)
      data[resultKey(field)] = await dispatch(field, args, mergedVariables)
    }

    return { data: data as T }
  } catch (err) {
    return { data: null, errors: [{ message: err instanceof Error ? err.message : String(err) }] }
  }
}

async function dispatch(field: FieldNode, args: Record<string, unknown>, variables: Record<string, unknown>) {
  const name = field.name.value

  let m = /^insert_(\w+)_one$/.exec(name)
  if (m) return insertOne(m[1], args, field, variables)

  m = /^insert_(\w+)$/.exec(name)
  if (m) return insertMany(m[1], args, field, variables)

  m = /^update_(\w+)_by_pk$/.exec(name)
  if (m) return updateByPk(m[1], args, field, variables)

  m = /^update_(\w+)$/.exec(name)
  if (m) return updateMany(m[1], args, field, variables)

  m = /^delete_(\w+)_by_pk$/.exec(name)
  if (m) return deleteByPk(m[1], args, field, variables)

  m = /^delete_(\w+)$/.exec(name)
  if (m) return deleteMany(m[1], args, field)

  m = /^(\w+)_aggregate$/.exec(name)
  if (m) return selectAggregate(m[1], args, field)

  m = /^(\w+)_by_pk$/.exec(name)
  if (m) return selectByPk(m[1], args, field, variables)

  return selectMany(name, args, field, variables)
}
