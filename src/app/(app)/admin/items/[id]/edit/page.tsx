import { hasuraQuery } from '@/lib/hasura/server'
import { ITEM_MASTER_BY_ID_QUERY } from '@/lib/hasura/queries'
import AdminItemMasterEditForm from '../../../AdminItemMasterEditForm'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export default async function EditItemMasterPage({ params }: { params: { id: string } }) {
  const data = await hasuraQuery(ITEM_MASTER_BY_ID_QUERY, { id: params.id }).catch(() => null)
  const item = (data as any)?.item_master_by_pk

  if (!item) notFound()

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link href="/admin/items" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Item Master</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Item</h1>
      <AdminItemMasterEditForm item={item} />
    </div>
  )
}
