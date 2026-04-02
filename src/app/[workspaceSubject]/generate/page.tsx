import GeneratePage from '@/app/(dashboard)/generate/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceGeneratePageProps {
  params: Promise<{ workspaceSubject: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceGeneratePage({ params, searchParams }: WorkspaceGeneratePageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)

  return (
    <GeneratePage
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
