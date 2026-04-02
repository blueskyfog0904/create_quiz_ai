import TextbookGeneratePage from '@/app/(dashboard)/generate/boards/[slug]/posts/[postId]/generate/[typeId]/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceTextbookGeneratePageProps {
  params: Promise<{ workspaceSubject: string; slug: string; postId: string; typeId: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceTextbookGeneratePage({ params, searchParams }: WorkspaceTextbookGeneratePageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <TextbookGeneratePage
      params={Promise.resolve({ slug: routeParams.slug, postId: routeParams.postId, typeId: routeParams.typeId })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
