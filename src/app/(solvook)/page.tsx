import type { Metadata } from 'next'
import { Suspense } from 'react'
import { connection } from 'next/server'
import { filterVisibleMainAdItems } from '@/lib/main-ad-carousel'
import { marketHomeReadFailed } from '@/lib/market-home'
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

export default async function SolvookHomePage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>
}) {
  await connection()
  const params = await searchParams
  const initialSubject = resolveSubject(params.subject) ?? 'korean'

  // 과목 탭 즉시 전환을 위해 양쪽 과목 데이터를 함께 로드한다 (60초 공유 캐시라 비용 미미).
  const [englishHome, koreanHome, englishAds, koreanAds] = await Promise.all([
    readHome('english'),
    readHome('korean'),
    getCachedMainAdItems('english'),
    getCachedMainAdItems('korean'),
  ])
  // 배너 기간 거르기는 캐시 밖에서 요청마다 한다(22번 3-5) — 시작·끝이 지나면 바로 반영된다.
  const now = new Date()

  return (
    <Suspense fallback={null}>
      <SolvookHomeView
        english={{ homeData: englishHome, adItems: filterVisibleMainAdItems(englishAds, now) }}
        korean={{ homeData: koreanHome, adItems: filterVisibleMainAdItems(koreanAds, now) }}
        initialSubject={initialSubject}
      />
    </Suspense>
  )
}
