import type { Metadata } from 'next'
import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { connection } from 'next/server'
import { getCachedMainAdItems, getCachedMarketHomeData } from '@/lib/preview-home-cache'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { SolvookHomeView } from './_components/solvook-home-view'

export const metadata: Metadata = {
  title: '써머썬 스튜디오 | 문제마켓',
  description: '영어와 국어 수업 자료를 과목별로 탐색하는 선생님용 문제마켓',
}

function resolveSubject(value?: string): WorkspaceSubject | null {
  return value === 'korean' || value === 'english' ? value : null
}

export default async function SolvookHomePage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>
}) {
  await connection()
  const [params, cookieStore] = await Promise.all([searchParams, cookies()])
  const initialSubject =
    resolveSubject(params.subject)
    ?? resolveSubject(cookieStore.get('preferred_workspace')?.value)
    ?? 'english'

  // 과목 탭 즉시 전환을 위해 양쪽 과목 데이터를 함께 로드한다 (60초 공유 캐시라 비용 미미).
  const [englishHome, koreanHome, englishAds, koreanAds] = await Promise.all([
    getCachedMarketHomeData('english'),
    getCachedMarketHomeData('korean'),
    getCachedMainAdItems('english'),
    getCachedMainAdItems('korean'),
  ])

  return (
    <Suspense fallback={null}>
      <SolvookHomeView
        english={{ homeData: englishHome, adItems: englishAds }}
        korean={{ homeData: koreanHome, adItems: koreanAds }}
        initialSubject={initialSubject}
      />
    </Suspense>
  )
}
