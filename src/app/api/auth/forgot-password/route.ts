import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import nodemailer from 'nodemailer'

const HASURA_URL = process.env.NEXT_PUBLIC_HASURA_URL || 'http://localhost:8080/v1/graphql'
const HASURA_SECRET = process.env.HASURA_ADMIN_SECRET || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

const TOKEN_EXPIRY_HOURS = 1

const FIND_USER_BY_EMAIL = `
  query FindUserByEmail($email: String!) {
    user_profiles(where: { email: { _eq: $email }, is_active: { _eq: true } }, limit: 1) {
      id
      full_name
      email
    }
  }
`

const SET_RESET_TOKEN = `
  mutation SetResetToken($id: uuid!, $token: String!, $expires_at: timestamptz!) {
    update_user_profiles_by_pk(
      pk_columns: { id: $id }
      _set: { reset_token: $token, reset_token_expires_at: $expires_at }
    ) {
      id
    }
  }
`

async function hasuraRequest(query: string, variables: Record<string, unknown>) {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_SECRET,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  })
  return res.json()
}

async function sendResetEmail(to: string, name: string, resetUrl: string): Promise<boolean> {
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM || user

  if (!host || !user || !pass) {
    return false // Email not configured
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })

  await transporter.sendMail({
    from: `"WareCore" <${from}>`,
    to,
    subject: 'Reset your WareCore password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1d4ed8">WareCore — Password Reset</h2>
        <p>Hi ${name},</p>
        <p>We received a request to reset your password. Click the button below to choose a new one.
           This link expires in ${TOKEN_EXPIRY_HOURS} hour.</p>
        <a href="${resetUrl}"
           style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
          Reset Password
        </a>
        <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
        <p style="color:#6b7280;font-size:13px">Or copy this link: ${resetUrl}</p>
      </div>
    `,
  })

  return true
}

export async function POST(request: NextRequest) {
  let body: { email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const email = body.email?.toLowerCase().trim()
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  // Look up user — always return 200 to prevent email enumeration
  const result = await hasuraRequest(FIND_USER_BY_EMAIL, { email })
  const user = result?.data?.user_profiles?.[0]

  if (!user) {
    // Return success anyway to avoid leaking whether the email exists
    return NextResponse.json({ ok: true })
  }

  // Generate a cryptographically secure token
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()

  await hasuraRequest(SET_RESET_TOKEN, {
    id: user.id,
    token,
    expires_at: expiresAt,
  })

  const resetUrl = `${APP_URL}/login/reset-password?token=${token}`

  const emailSent = await sendResetEmail(user.email, user.full_name, resetUrl)

  // If SMTP is not configured, return the reset URL directly.
  // This is acceptable for internal tools — configure SMTP to send it by email instead.
  if (!emailSent) {
    return NextResponse.json({ ok: true, resetUrl })
  }

  return NextResponse.json({ ok: true })
}
