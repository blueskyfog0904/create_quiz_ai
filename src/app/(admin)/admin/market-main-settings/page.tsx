import type { Metadata } from 'next'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { filterVisibleMainAdItems, getActiveMainAdCarouselItems } from '@/lib/main-ad-carousel'
import { getMainAdCarouselConfig } from '@/lib/main-ad-carousel-server'
import { getMarketHomeAdminData } from '@/lib/market-home-server'
import MarketMainSettingsClient from './market-main-settings-client'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/market-main-settings',
    fallbackName: '(임시) 문제마켓 메인 관리',
    searchParams,
    description: '문제마켓 메인의 과목별 노출 설정을 관리합니다.',
  })
}

interface MarketMainSettingsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

// 22번 홈 진열(계획 6절): 섹션 표·추가·편집 창·회원 홈 미리보기. 미리보기의 빈 홈 링크 판정에 지금 보이는 배너 수를 쓴다.
export default async function MarketMainSettingsPage({
  searchParams,
}: MarketMainSettingsPageProps) {
  await requireAdminPagePermission('storefront.edit')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  const [data, bannerConfig] = await Promise.all([
    getMarketHomeAdminData(workspaceSubject),
    getMainAdCarouselConfig(),
  ])
  const visibleBannerCount = filterVisibleMainAdItems(getActiveMainAdCarouselItems(bannerConfig, workspaceSubject), new Date()).length

  return (
    <MarketMainSettingsClient
      {...data}
      visibleBannerCount={visibleBannerCount}
      key={workspaceSubject}
      workspaceSubject={workspaceSubject}
    />
  )
}
