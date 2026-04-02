import MarketLibraryPage from '@/app/(dashboard)/library/market/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceLibraryMarketPageProps {
  params: Promise<{ workspaceSubject: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceLibraryMarketPage({ params, searchParams }: WorkspaceLibraryMarketPageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)

  return (
    <MarketLibraryPage
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
