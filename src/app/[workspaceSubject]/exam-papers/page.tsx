import ExamPapersPage from '@/app/(dashboard)/exam-papers/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceExamPapersPageProps {
  params: Promise<{ workspaceSubject: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceExamPapersPage({ params, searchParams }: WorkspaceExamPapersPageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)

  return (
    <ExamPapersPage
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
