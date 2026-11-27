import type { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import ReviewsAdminClient from './reviews-admin-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/reviews',
    fallbackName: '후기 관리',
    searchParams,
    description: '문제마켓 자료 후기를 조회하고 부적절한 후기를 삭제합니다.',
  })
}

interface ReviewsAdminPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function ReviewsAdminPage({ searchParams }: ReviewsAdminPageProps) {
  await requireAdminPagePermission('reviews.manage')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div>
      <AdminPageHeader
        title={<><AdminMenuName href="/admin/reviews" fallback="후기 관리" /> · {workspaceSubject === 'english' ? '영어' : '국어'}</>}
        description="삭제한 후기는 화면과 평점 집계에서 즉시 제외됩니다."
      />
      <ReviewsAdminClient workspaceSubject={workspaceSubject} />
    </div>
  )
}
