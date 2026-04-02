import LibraryExamPaperDetailPage from '@/app/(dashboard)/library/exam-papers/[id]/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceLibraryExamPaperDetailPageProps {
  params: Promise<{ workspaceSubject: string; id: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceLibraryExamPaperDetailPage({ params, searchParams }: WorkspaceLibraryExamPaperDetailPageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <LibraryExamPaperDetailPage
      params={Promise.resolve({ id: routeParams.id })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
