'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { getActiveHeaderNavigationItems } from '@/lib/header-navigation'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import {
  getMainLandingConfig,
  getWorkspaceLandingConfig,
  saveMainLandingConfig,
  saveWorkspaceLandingConfig,
} from '@/lib/landing-page-server'
import type { MainLandingConfig, WorkspaceLandingConfig } from '@/lib/landing-page'
import { resolveWorkspaceLandingQuickEntryTargets } from '@/lib/workspace-landing-quick-entry'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

export type LandingEditorTarget = 'main' | WorkspaceSubject

export interface LandingPagesAdminData {
  mainConfig: MainLandingConfig
  workspaceConfigs: Record<WorkspaceSubject, WorkspaceLandingConfig>
  quickEntryTargets: Record<WorkspaceSubject, ReturnType<typeof resolveWorkspaceLandingQuickEntryTargets>>
}

function revalidateLandingPaths() {
  revalidatePath('/')
  revalidatePath('/english')
  revalidatePath('/korean')
  revalidatePath('/admin/landing-pages')
}

export async function getLandingPagesAdminData(): Promise<LandingPagesAdminData> {
  await requireAdmin()

  const [mainConfig, englishConfig, koreanConfig, englishNav, koreanNav] = await Promise.all([
    getMainLandingConfig(),
    getWorkspaceLandingConfig('english'),
    getWorkspaceLandingConfig('korean'),
    getHeaderNavigationConfig('english'),
    getHeaderNavigationConfig('korean'),
  ])

  return {
    mainConfig,
    workspaceConfigs: {
      english: englishConfig,
      korean: koreanConfig,
    },
    quickEntryTargets: {
      english: resolveWorkspaceLandingQuickEntryTargets('english', getActiveHeaderNavigationItems(englishNav.items)),
      korean: resolveWorkspaceLandingQuickEntryTargets('korean', getActiveHeaderNavigationItems(koreanNav.items)),
    },
  }
}

export async function saveMainLandingConfigAction(config: MainLandingConfig) {
  await requireAdmin()
  const saved = await saveMainLandingConfig(config)
  revalidateLandingPaths()
  return { success: true, data: saved }
}

export async function saveWorkspaceLandingConfigAction(
  subject: WorkspaceSubject,
  config: WorkspaceLandingConfig
) {
  const user = await requireAdmin()
  const saved = await saveWorkspaceLandingConfig(subject, config, user.id)
  revalidateLandingPaths()
  return { success: true, data: saved }
}
