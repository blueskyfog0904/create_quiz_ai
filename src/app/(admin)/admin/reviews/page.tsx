import type { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import ReviewsAdminClient from './reviews-admin-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'

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
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">
          <AdminMenuName href="/admin/reviews" fallback="후기 관리" /> · {workspaceSubject === 'english' ? '영어' : '국어'}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        삭제한 후기는 화면과 평점 집계에서 즉시 제외됩니다.
      </p>
      <ReviewsAdminClient workspaceSubject={workspaceSubject} />
    </div>
  )
}
