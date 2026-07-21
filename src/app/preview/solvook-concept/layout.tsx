import type { CSSProperties, ReactNode } from 'react'
import { PreviewFooter } from './_components/preview-footer'
import { PreviewHeader } from './_components/preview-header'

const previewTokens = {
  '--preview-background': '#F7F8FA',
  '--preview-surface': '#FFFFFF',
  '--preview-ink': '#1C1F2E',
  '--preview-text': '#3B4054',
  '--preview-muted': '#6A708A',
  '--preview-primary': '#6950E5',
  '--preview-mint': '#63CDB7',
  '--preview-coral': '#F46D5E',
  '--preview-border': '#E1E4ED',
} as CSSProperties

export default function SolvookConceptPreviewLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div
      style={previewTokens}
      className="flex min-h-screen flex-col bg-[var(--preview-background)] text-[var(--preview-text)]"
    >
      <PreviewHeader />
      <main className="flex-1">
        {children}
      </main>
      <PreviewFooter />
    </div>
  )
}
