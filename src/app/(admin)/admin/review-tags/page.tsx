import type { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import ReviewTagsClient from './review-tags-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/review-tags',
    fallbackName: '후기 태그 관리',
    searchParams,
    description: '후기 작성 시 선택할 수 있는 추천 태그를 관리합니다.',
  })
}

interface ReviewTagsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function ReviewTagsPage({ searchParams }: ReviewTagsPageProps) {
  await requireAdminPagePermission('reviews.manage')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div>
      <AdminPageHeader
        title={<><AdminMenuName href="/admin/review-tags" fallback="후기 태그 관리" /> · {workspaceSubject === 'english' ? '영어' : '국어'}</>}
        description="후기 작성 화면에 노출되는 추천 태그입니다. 비활성화해도 이미 작성된 후기에는 라벨이 유지됩니다."
      />
      <ReviewTagsClient workspaceSubject={workspaceSubject} />
    </div>
  )
}
