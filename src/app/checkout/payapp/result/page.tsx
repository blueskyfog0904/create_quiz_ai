import { StudioContainer } from '@/components/design-system'
import { PayAppResultClient } from './result-client'

export default async function PayAppResultPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string | string[] }>
}) {
  const { orderId } = await searchParams

  return (
    <main className="studio-theme min-h-screen overflow-x-hidden bg-[var(--studio-background)] py-10 text-[var(--studio-text)] sm:py-16">
      <StudioContainer>
        <div className="grid min-w-0 gap-6 md:grid-cols-3">
          <div className="min-w-0 md:col-start-2">
            <PayAppResultClient orderId={typeof orderId === 'string' ? orderId : ''} />
          </div>
        </div>
      </StudioContainer>
    </main>
  )
}
