import { redirect } from 'next/navigation'
import { resolveWorkspaceRouteParams } from '@/app/subject-route-helpers'

interface WorkspaceMultiGeneratePageProps {
  params: Promise<{ workspaceSubject: string }>
}

export default async function WorkspaceMultiGeneratePage({ params }: WorkspaceMultiGeneratePageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)
  redirect(`/${workspaceSubject}/generate/personal`)
}
