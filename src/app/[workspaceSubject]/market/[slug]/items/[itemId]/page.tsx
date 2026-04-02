import MarketItemDetailPage from '@/app/(dashboard)/market/[slug]/items/[itemId]/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceMarketItemDetailPageProps {
  params: Promise<{ workspaceSubject: string; slug: string; itemId: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceMarketItemDetailPage({ params, searchParams }: WorkspaceMarketItemDetailPageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <MarketItemDetailPage
      params={Promise.resolve({ slug: routeParams.slug, itemId: routeParams.itemId })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
