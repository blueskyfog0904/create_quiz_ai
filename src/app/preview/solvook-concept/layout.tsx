import { Suspense, type ReactNode } from 'react'
import { PreviewFooter } from './_components/preview-footer'
import { PreviewHeader } from './_components/preview-header'

export default function SolvookConceptPreviewLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="studio-theme flex min-h-screen flex-col">
      <Suspense fallback={null}>
        <PreviewHeader />
      </Suspense>
      <main className="flex-1">
        {children}
      </main>
      <Suspense fallback={null}>
        <PreviewFooter />
      </Suspense>
    </div>
  )
}
