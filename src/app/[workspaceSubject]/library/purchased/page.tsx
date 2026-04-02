import PurchasedPage from '@/app/(dashboard)/library/purchased/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspacePurchasedPageProps {
  params: Promise<{ workspaceSubject: string }>
  searchParams?: Promise<{ jobId?: string; marketSlug?: string; subject?: string }>
}

export default async function WorkspacePurchasedPage({ params, searchParams }: WorkspacePurchasedPageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)

  return (
    <PurchasedPage
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
