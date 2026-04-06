import { getActiveHeaderNavigationItems } from '@/lib/header-navigation'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import type { WorkspaceLandingConfig } from '@/lib/landing-page'
import { resolveWorkspaceLandingQuickEntryTargets } from '@/lib/workspace-landing-quick-entry'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { WorkspaceLandingView } from './WorkspaceLandingView'

interface WorkspaceLandingProps {
  subject: WorkspaceSubject
  isLoggedIn: boolean
  config: WorkspaceLandingConfig
}

export async function WorkspaceLanding({ subject, isLoggedIn, config }: WorkspaceLandingProps) {
  const navigationConfig = await getHeaderNavigationConfig(subject)
  const activeNavigationItems = getActiveHeaderNavigationItems(navigationConfig.items)
  const quickEntry = resolveWorkspaceLandingQuickEntryTargets(subject, activeNavigationItems)

  return (
    <WorkspaceLandingView
      subject={subject}
      config={config}
      quickEntry={quickEntry}
    />
  )
}
