import { StudioContainer } from '@/components/design-system'
import { KakaoPayResultClient } from './result-client'

export default function KakaoPayResultPage() {
  return (
    <main className="studio-theme min-h-screen overflow-x-hidden bg-[var(--studio-background)] py-10 text-[var(--studio-text)] sm:py-16">
      <StudioContainer>
        <div className="grid min-w-0 gap-6 md:grid-cols-3">
          <div className="min-w-0 md:col-start-2">
            <KakaoPayResultClient />
          </div>
        </div>
      </StudioContainer>
    </main>
  )
}
