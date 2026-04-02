import GenerateBoardJobPage from '@/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceGenerateBoardJobPageProps {
  params: Promise<{ workspaceSubject: string; slug: string; postId: string; jobId: string }>
  searchParams: Promise<{ gradeLevel?: string; difficulty?: string; subject?: string }>
}

export default async function WorkspaceGenerateBoardJobPage({ params, searchParams }: WorkspaceGenerateBoardJobPageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <GenerateBoardJobPage
      params={Promise.resolve({ slug: routeParams.slug, postId: routeParams.postId, jobId: routeParams.jobId })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
