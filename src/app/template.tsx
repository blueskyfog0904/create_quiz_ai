import { Suspense } from 'react'
import { LoginCompleteDialog } from '@/components/auth/login-complete-dialog'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { PathAwareSiteChrome } from '@/components/layout/path-aware-site-chrome'

export default function RootTemplate({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <PathAwareSiteChrome
        header={<Header />}
        footer={<Footer />}
      >
        {children}
      </PathAwareSiteChrome>
      <Suspense fallback={null}>
        <LoginCompleteDialog />
      </Suspense>
    </>
  )
}
