import GenerateWithTypePage from '@/app/(dashboard)/generate/[typeId]/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceGenerateWithTypePageProps {
  params: Promise<{ workspaceSubject: string; typeId: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceGenerateWithTypePage({ params, searchParams }: WorkspaceGenerateWithTypePageProps) {
  const { workspaceSubject, routeParams } = await resolveWorkspaceRouteParams(params)

  return (
    <GenerateWithTypePage
      params={Promise.resolve({ typeId: routeParams.typeId })}
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
