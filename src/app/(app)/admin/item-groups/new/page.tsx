import Link from 'next/link'
import AdminSimpleForm from '../../AdminSimpleForm'

export default function NewItemGroupPage() {
  return (
    <div className="p-6 max-w-xl mx-auto">
      <Link href="/admin/item-groups" className="text-sm text-blue-600 hover:underline mb-4 block">← Back to Item Groups</Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Item Group</h1>
      <AdminSimpleForm table="item_groups" label="Item Group" fields={['group_code', 'group_desc']} />
    </div>
  )
}
