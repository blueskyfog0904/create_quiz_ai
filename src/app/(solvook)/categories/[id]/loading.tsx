import { StudioContainer } from '@/components/design-system/studio-container'

// 카테고리 이동(메인 광고·메가메뉴·사이드바 클릭) 직후 바로 보이는 자리표시 화면.
// 실제 화면(CategoryItemsView)과 같은 배치로 그려 데이터가 오면 자연스럽게 교체된다.
const BLOCK = 'rounded bg-[var(--studio-border)]'

export default function CategoryLoading() {
  return (
    <StudioContainer className="py-8 sm:py-10">
      <div className="flex animate-pulse items-start gap-10" aria-busy="true" aria-label="카테고리 자료를 불러오는 중">
        <aside className="hidden w-56 shrink-0 space-y-3 lg:block">
          <div className={`h-6 w-16 ${BLOCK}`} />
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className={`h-4 ${index % 3 === 0 ? 'w-32' : 'w-44'} ${BLOCK}`} />
          ))}
        </aside>

        <div className="min-w-0 flex-1">
          <div className={`h-4 w-28 ${BLOCK}`} />
          <div className={`mt-2 h-8 w-64 ${BLOCK}`} />

          <div className={`mt-8 h-6 w-32 ${BLOCK}`} />
          <div className={`mt-3 h-24 w-full ${BLOCK}`} />

          <ul className="mt-8 divide-y divide-[var(--studio-border)]">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index} className="flex items-center gap-5 py-5">
                <div className={`h-[96px] w-[72px] shrink-0 ${BLOCK}`} />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className={`h-5 w-3/4 ${BLOCK}`} />
                  <div className={`h-4 w-1/3 ${BLOCK}`} />
                </div>
                <div className={`hidden h-9 w-20 sm:block ${BLOCK}`} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </StudioContainer>
  )
}
