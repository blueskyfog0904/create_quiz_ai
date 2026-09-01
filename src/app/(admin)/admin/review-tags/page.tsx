import { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import ReviewTagsClient from './review-tags-client'

export const metadata: Metadata = {
  title: '후기 태그 관리 | 관리자 패널',
  description: '후기 작성 시 선택할 수 있는 추천 태그를 관리합니다.',
}

interface ReviewTagsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function ReviewTagsPage({ searchParams }: ReviewTagsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">
          후기 태그 관리 · {workspaceSubject === 'english' ? '영어' : '국어'}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        후기 작성 화면에 노출되는 추천 태그입니다. 비활성화해도 이미 작성된 후기에는 라벨이 유지됩니다.
      </p>
      <ReviewTagsClient workspaceSubject={workspaceSubject} />
    </div>
  )
}
