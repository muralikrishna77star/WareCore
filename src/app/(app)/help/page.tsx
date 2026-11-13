import { HelpCenter } from './HelpCenter'

export const metadata = { title: 'Help & How-To · WareCore' }

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string; from?: string; tab?: string }> }) {
  const { q, from, tab } = await searchParams
  return <HelpCenter initialQuery={q ?? ''} from={from ?? ''} initialTab={tab === 'index' ? 'index' : 'topics'} />
}
