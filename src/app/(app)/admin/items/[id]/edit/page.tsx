import { hasuraQuery } from '@/lib/hasura/server'
import { ITEM_MASTER_BY_ID_QUERY } from '@/lib/hasura/queries'
import AdminItemMasterEditForm from '../../../AdminItemMasterEditForm'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import type { ItemMaster } from '@/types'

type ItemMasterEditData = ItemMaster & { material_types?: { code: string; description: string } }

export default async function EditItemMasterPage({ params }: { params: { id: string } }) {
  const data = await hasuraQuery(ITEM_MASTER_BY_ID_QUERY, { id: params.id }).catch(() => null)
  const item = data?.item_master_by_pk as ItemMasterEditData | undefined

  if (!item) notFound()

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link href="/admin/items" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4"><ArrowLeft className="h-4 w-4" /> Back to Item Master</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Item</h1>
      <AdminItemMasterEditForm item={item} />
    </div>
  )
}
