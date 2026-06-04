import { NextRequest, NextResponse } from 'next/server'
import { verifySessionCookie } from '@/lib/auth/session'

export async function GET(request: NextRequest) {
  const session = await verifySessionCookie(request)
  if (!session) {
    return NextResponse.json({ email: null }, { status: 200 })
  }
  return NextResponse.json({ email: session.email }, { status: 200 })
}
