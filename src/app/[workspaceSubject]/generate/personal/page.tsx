import PersonalGeneratePage from '@/app/(dashboard)/generate/personal/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspacePersonalGeneratePageProps {
  params: Promise<{ workspaceSubject: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspacePersonalGeneratePage({ params, searchParams }: WorkspacePersonalGeneratePageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)

  return (
    <PersonalGeneratePage
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
