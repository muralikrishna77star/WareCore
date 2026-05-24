import { NextResponse } from 'next/server'
import { getAppUrl, getGoogleRedirectUri, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, HASURA_URL, HASURA_ADMIN_SECRET } from '@/lib/env'

export async function GET() {
  const appUrl = getAppUrl()
  const clientId = GOOGLE_CLIENT_ID
  const clientSecret = GOOGLE_CLIENT_SECRET

  return NextResponse.json({
    deployed_at: new Date().toISOString(),
    app_url: appUrl,
    redirect_uri: getGoogleRedirectUri(),
    client_id_set: !!clientId,
    client_id_last4: clientId.slice(-4),
    client_secret_set: !!clientSecret,
    client_secret_last4: clientSecret.slice(-4),
    client_secret_length: clientSecret.length,
    hasura_url_set: !!HASURA_URL,
    hasura_secret_set: !!HASURA_ADMIN_SECRET,
    node_env: process.env.NODE_ENV,
  })
}
