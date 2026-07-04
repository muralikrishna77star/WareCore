'use client'

import type { ReactNode } from 'react'
import type { ReferenceType } from '@/lib/reference'
import { useRecordPreview } from '@/components/RecordPreviewProvider'

export function ReferenceLink({
  type,
  id,
  className,
  children,
}: {
  type: ReferenceType
  id: string
  className?: string
  children: ReactNode
}) {
  const { openRecord } = useRecordPreview()
  return (
    <button
      type="button"
      onClick={() => openRecord(type, id)}
      className={className ?? 'text-blue-600 hover:text-blue-800 text-xs font-medium'}
    >
      {children}
    </button>
  )
}
