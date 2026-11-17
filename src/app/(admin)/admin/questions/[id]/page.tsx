import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { EditQuestionClient } from './edit-question-client'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function EditQuestionPage({ params, searchParams }: PageProps) {
  // 꺼 둔 기능의 화면이다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 본다.
  await requireAdminPagePermission('owner')
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div>
      <EditQuestionClient questionId={id} workspaceSubject={workspaceSubject} />
    </div>
  )
}

