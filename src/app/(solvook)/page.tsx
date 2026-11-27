import type { Metadata } from 'next'
import { Suspense } from 'react'
import { connection } from 'next/server'
import { filterVisibleMainAdItems } from '@/lib/main-ad-carousel'
import { marketHomeReadFailed } from '@/lib/market-home'
import { visibleInfoItemLabel } from '@/lib/market-item-options'
import { getMarketItemDisplay } from '@/lib/market-item-options-server'
import { getCachedMainAdItems, getCachedMarketHomeData } from '@/lib/preview-home-cache'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { SolvookHomeView } from './_components/solvook-home-view'

export const metadata: Metadata = {
  title: '문제마켓',
}

function resolveSubject(value?: string): WorkspaceSubject | null {
  return value === 'korean' || value === 'english' ? value : null
}

// 캐시 첫 채움부터 읽기가 실패하면 섹션 없이 배너만 그린다(22번 3-3). 이전 정상 값이 있으면 캐시가 그 값을 준다.
function readHome(subject: WorkspaceSubject) {
  return getCachedMarketHomeData(subject).catch((error: unknown) => {
    console.error('[market-home] 회원 홈 데이터를 읽지 못했습니다. 배너만 그립니다.', { subject, message: error instanceof Error ? error.message : String(error) })
    return marketHomeReadFailed(subject)
  })
}

// 최근 등록 섹션의 자료 등록일 이름(DB 상품 표시 설정, 60초 캐시). 숨겼거나 읽지 못하면 null — 날짜만 숨긴다.
function readRegisteredAtLabel() {
  return getMarketItemDisplay().then((display) => visibleInfoItemLabel(display.detail, 'registeredAt')).catch((error: unknown) => {
    console.error('[market-home] 상품 표시 설정을 읽지 못했습니다. 자료 등록일을 숨깁니다.', error instanceof Error ? error.message : String(error))
    return null
  })
}

export default async function SolvookHomePage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>
}) {
  await connection()
  const params = await searchParams
  const initialSubject = resolveSubject(params.subject) ?? 'korean'

  // 과목 탭 즉시 전환을 위해 양쪽 과목 데이터를 함께 로드한다 (60초 공유 캐시라 비용 미미).
  const [englishHome, koreanHome, englishAds, koreanAds, registeredAtLabel] = await Promise.all([
    readHome('english'),
    readHome('korean'),
    getCachedMainAdItems('english'),
    getCachedMainAdItems('korean'),
    readRegisteredAtLabel(),
  ])
  // 배너 기간 거르기는 캐시 밖에서 요청마다 한다(22번 3-5) — 시작·끝이 지나면 바로 반영된다.
  const now = new Date()

  return (
    <Suspense fallback={null}>
      <SolvookHomeView
        english={{ homeData: englishHome, adItems: filterVisibleMainAdItems(englishAds, now) }}
        korean={{ homeData: koreanHome, adItems: filterVisibleMainAdItems(koreanAds, now) }}
        initialSubject={initialSubject}
        registeredAtLabel={registeredAtLabel}
      />
    </Suspense>
  )
}
