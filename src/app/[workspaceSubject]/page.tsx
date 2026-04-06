import { WorkspaceLanding } from '@/components/features/landing/WorkspaceLanding'
import { resolveWorkspaceRouteParams } from '@/app/subject-route-helpers'
import { getWorkspaceLandingConfig } from '@/lib/landing-page-server'

interface WorkspaceHomePageProps {
  params: Promise<{ workspaceSubject: string }>
}

export default async function WorkspaceHomePage({ params }: WorkspaceHomePageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)
  const config = await getWorkspaceLandingConfig(workspaceSubject)

  return <WorkspaceLanding subject={workspaceSubject} config={config} />
}
