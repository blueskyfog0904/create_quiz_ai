import { createClient } from '@/lib/supabase/server'
import { WorkspaceLanding } from '@/components/features/landing/WorkspaceLanding'
import { resolveWorkspaceRouteParams } from '@/app/subject-route-helpers'

interface WorkspaceHomePageProps {
  params: Promise<{ workspaceSubject: string }>
}

export default async function WorkspaceHomePage({ params }: WorkspaceHomePageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return <WorkspaceLanding subject={workspaceSubject} isLoggedIn={Boolean(user)} />
}
