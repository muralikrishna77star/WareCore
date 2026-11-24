import { WebsiteHeader, WebsiteFooter } from '@/components/website/WebsiteChrome'

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <WebsiteHeader />
      {children}
      <WebsiteFooter />
    </div>
  )
}
