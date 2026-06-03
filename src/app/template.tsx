import { Suspense } from 'react'
import { LoginCompleteDialog } from '@/components/auth/login-complete-dialog'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'

export default function RootTemplate({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        {children}
      </main>
      <Suspense fallback={null}>
        <LoginCompleteDialog />
      </Suspense>
      <Footer />
    </div>
  )
}
