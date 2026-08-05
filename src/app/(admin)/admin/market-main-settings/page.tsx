import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { getMarketHomeAdminData } from '@/lib/market-home-server'
import MarketMainSettingsClient from './market-main-settings-client'

export const metadata: Metadata = {
  title: '(임시) 문제마켓 메인 관리 | 관리자 패널',
  description: '문제마켓 메인의 과목별 노출 설정을 관리합니다.',
}

interface MarketMainSettingsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MarketMainSettingsPage({
  searchParams,
}: MarketMainSettingsPageProps) {
  await requireAdmin('/admin/market-main-settings')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  const data = await getMarketHomeAdminData(workspaceSubject)

  return (
    <MarketMainSettingsClient
      {...data}
      key={workspaceSubject}
      workspaceSubject={workspaceSubject}
    />
  )
}
