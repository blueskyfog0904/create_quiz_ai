import MarketBoardPreviewPage from '@/app/(dashboard)/market/[slug]/board-preview/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceMarketBoardPreviewPageProps {
  params: Promise<{ workspaceSubject: string; slug: string }>
  searchParams: Promise<{
    year?: string
    month?: string
    grade?: string
    title?: string
    subject?: string
  }>
}

export default async function WorkspaceMarketBoardPreviewPage({ params, searchParams }: WorkspaceMarketBoardPreviewPageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <MarketBoardPreviewPage
      params={Promise.resolve({ slug: routeParams.slug })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
