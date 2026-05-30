import { hasuraQuery } from '@/lib/hasura/server'
import { ACTIVE_ITEM_GROUPS_QUERY, MATERIAL_TYPES_QUERY, MATERIAL_SIZES_QUERY, ACTIVE_ITEM_MASTER_QUERY } from '@/lib/hasura/queries'
import AdminItemMasterForm from '../../AdminItemMasterForm'
import Link from 'next/link'

export default async function NewItemMasterPage() {
  const [groupsRes, materialTypesRes, materialSizesRes, existingItemsRes] = await Promise.all([
    hasuraQuery(ACTIVE_ITEM_GROUPS_QUERY).catch(() => ({ item_groups: [] })),
    hasuraQuery(MATERIAL_TYPES_QUERY).catch(() => ({ material_types: [] })),
    hasuraQuery(MATERIAL_SIZES_QUERY).catch(() => ({ material_sizes: [] })),
    hasuraQuery(ACTIVE_ITEM_MASTER_QUERY).catch(() => ({ item_master: [] })),
  ])

  const itemGroups = (groupsRes as any).item_groups ?? []
  const materialTypes = (materialTypesRes as any).material_types ?? []
  const materialSizes = (materialSizesRes as any).material_sizes ?? []
  const existingItems = (existingItemsRes as any).item_master ?? []

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link href="/admin/items" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Item Master</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Item Master</h1>
      <AdminItemMasterForm
        itemGroups={itemGroups}
        materialTypes={materialTypes}
        materialSizes={materialSizes}
        existingItems={existingItems}
      />
    </div>
  )
}
