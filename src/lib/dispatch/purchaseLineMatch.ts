// Which purchase lines the Sale Entry picker offers for a selected item.
//
// A line tagged with an item_master_id belongs to that item and nothing else —
// matching it by material type as well let an item with no size set (e.g.
// HR00206 "HR 2.30 X 325") pull in every HR line in stock, other items'
// included. Material/size matching is only a fallback for untagged lines
// (legacy or job-work output stock), and even then an item with no size
// matches nothing rather than everything of its type.

export type MatchableItem = {
  id: string
  material_type_id: string
  material_size_id?: string | null
  size_label?: string | null
}

export type MatchableLine = {
  item_master_id: string | null
  material_type_id: string
  material_size_id: string | null
  size_label: string | null
}

export function purchaseLineMatchesItem(line: MatchableLine, item: MatchableItem): boolean {
  if (line.item_master_id) return line.item_master_id === item.id
  if (line.material_type_id !== item.material_type_id) return false
  if (item.material_size_id && line.material_size_id === item.material_size_id) return true
  return !!(item.size_label && line.size_label && line.size_label === item.size_label)
}
