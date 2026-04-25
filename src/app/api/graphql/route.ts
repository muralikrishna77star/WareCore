import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''

export async function POST(request: NextRequest) {
  // Verify the caller is authenticated
  const session = await verifySessionCookie(request)
  if (!session) {
    return NextResponse.json({ errors: [{ message: 'Unauthorized' }] }, { status: 401 })
  }

  const body = await request.json()

  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  const data = await res.json()
  return NextResponse.json(data, { status: res.status })
}
