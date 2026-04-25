import { NextResponse } from 'next/server'

export async function GET() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').trim()
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || ''

  return NextResponse.json({
    app_url: appUrl,
    redirect_uri: `${appUrl}/api/auth/google/callback`,
    client_id_set: !!clientId,
    client_id_last4: clientId.slice(-4),
    client_secret_set: !!clientSecret,
    client_secret_last4: clientSecret.slice(-4),
    hasura_url_set: !!process.env.NEXT_PUBLIC_HASURA_URL,
    hasura_secret_set: !!process.env.HASURA_ADMIN_SECRET,
    node_env: process.env.NODE_ENV,
  })
}
