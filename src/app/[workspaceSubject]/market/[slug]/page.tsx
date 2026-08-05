import MarketCategoryPage from '@/app/(dashboard)/market/[slug]/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceMarketCategoryPageProps {
  params: Promise<{ workspaceSubject: string; slug: string }>
  searchParams: Promise<{
    year?: string
    month?: string
    grade?: string
    title?: string
    subject?: string
    sourceType?: string
    source1?: string
    source2?: string
    source3?: string
    source4?: string
  }>
}

export default async function WorkspaceMarketCategoryPage({ params, searchParams }: WorkspaceMarketCategoryPageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <MarketCategoryPage
      params={Promise.resolve({ slug: routeParams.slug })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
