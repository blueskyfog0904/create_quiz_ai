import ExamPaperDetailPage from '@/app/(dashboard)/exam-papers/[id]/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceExamPaperDetailPageProps {
  params: Promise<{ workspaceSubject: string; id: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceExamPaperDetailPage({ params, searchParams }: WorkspaceExamPaperDetailPageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <ExamPaperDetailPage
      params={Promise.resolve({ id: routeParams.id })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
