import { StudioContainer } from '@/components/design-system/studio-container'

// 상품 클릭 직후 바로 보이는 자리표시 화면.
// 실제 화면(MarketMaterialDetail)과 같은 배치로 그려 데이터가 오면 자연스럽게 교체된다.
const BLOCK = 'rounded bg-[var(--studio-border)]'

export default function MarketItemDetailLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="자료 정보를 불러오는 중">
      <section className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)]">
        <StudioContainer className="py-6">
          <div className={`h-11 w-72 max-w-full ${BLOCK}`} />
        </StudioContainer>
      </section>
      <StudioContainer className="py-7 sm:py-9">
        <div className="flex items-start gap-10">
          <aside className="hidden w-56 shrink-0 space-y-3 lg:block">
            <div className={`h-6 w-16 ${BLOCK}`} />
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className={`h-4 ${index % 3 === 0 ? 'w-32' : 'w-44'} ${BLOCK}`} />
            ))}
          </aside>

          <div className="grid min-w-0 flex-1 gap-7 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] p-5 sm:p-7 md:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)]">
            <div className={`mx-auto aspect-[3/4] w-full max-w-[220px] ${BLOCK}`} />
            <div className="min-w-0 space-y-4 py-1">
              <div className={`h-6 w-24 ${BLOCK}`} />
              <div className={`h-8 w-3/4 ${BLOCK}`} />
              <div className={`h-4 w-40 ${BLOCK}`} />
              <div className={`h-32 w-full ${BLOCK}`} />
            </div>
          </div>
        </div>
      </StudioContainer>
    </div>
  )
}
