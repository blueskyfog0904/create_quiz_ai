import GenerateBoardPostPage from '@/app/(dashboard)/generate/boards/[slug]/posts/[postId]/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceGenerateBoardPostPageProps {
  params: Promise<{ workspaceSubject: string; slug: string; postId: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceGenerateBoardPostPage({ params, searchParams }: WorkspaceGenerateBoardPostPageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <GenerateBoardPostPage
      params={Promise.resolve({ slug: routeParams.slug, postId: routeParams.postId })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
