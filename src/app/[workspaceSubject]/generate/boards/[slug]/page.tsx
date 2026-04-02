import GenerateBoardPage from '@/app/(dashboard)/generate/boards/[slug]/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceGenerateBoardPageProps {
  params: Promise<{ workspaceSubject: string; slug: string }>
  searchParams: Promise<{
    year?: string
    month?: string
    grade?: string
    title?: string
    subject?: string
  }>
}

export default async function WorkspaceGenerateBoardPage({ params, searchParams }: WorkspaceGenerateBoardPageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <GenerateBoardPage
      params={Promise.resolve({ slug: routeParams.slug })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
