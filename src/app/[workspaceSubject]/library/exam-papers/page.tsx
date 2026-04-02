import LibraryExamPapersPage from '@/app/(dashboard)/library/exam-papers/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceLibraryExamPapersPageProps {
  params: Promise<{ workspaceSubject: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceLibraryExamPapersPage({ params, searchParams }: WorkspaceLibraryExamPapersPageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)

  return (
    <LibraryExamPapersPage
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
