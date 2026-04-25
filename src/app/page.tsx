import { redirect } from 'next/navigation'

export default async function RootPage() {
  // TODO: check session cookie for auth
  redirect('/dashboard')
}


