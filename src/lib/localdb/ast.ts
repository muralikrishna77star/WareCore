import { FieldNode, SelectionSetNode, valueFromASTUntyped } from 'graphql'

/** Evaluates a GraphQL field's arguments to a plain JS object, substituting variables. */
export function evalArgs(field: FieldNode, variables: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const arg of field.arguments ?? []) {
    args[arg.name.value] = valueFromASTUntyped(arg.value, variables)
  }
  return args
}

/** Returns the direct field selections of a selection set, skipping fragments/__typename. */
export function fieldSelections(selectionSet: SelectionSetNode | undefined): FieldNode[] {
  if (!selectionSet) return []
  return selectionSet.selections.filter(
    (s): s is FieldNode => s.kind === 'Field' && s.name.value !== '__typename'
  )
}

export function resultKey(field: FieldNode): string {
  return field.alias?.value ?? field.name.value
}
