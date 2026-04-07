import { getWorkspaceSettingValue, upsertWorkspaceSetting, type WorkspaceSubject } from '@/lib/workspace-settings'
import {
  ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY,
  normalizeAdminSidebarNavigationConfig,
  type AdminSidebarNavigationConfig,
} from '@/lib/admin-sidebar'
import type { Json } from '@/types/supabase'

export async function getAdminSidebarNavigationConfig(
  workspaceSubject: WorkspaceSubject
): Promise<AdminSidebarNavigationConfig> {
  const value = await getWorkspaceSettingValue<AdminSidebarNavigationConfig | Json>(
    workspaceSubject,
    ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY
  )

  return normalizeAdminSidebarNavigationConfig(value)
}

export async function saveAdminSidebarNavigationConfig(
  config: AdminSidebarNavigationConfig,
  workspaceSubject: WorkspaceSubject
) {
  const normalized = normalizeAdminSidebarNavigationConfig(config)

  await upsertWorkspaceSetting({
    workspaceSubject,
    settingKey: ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY,
    value: normalized as unknown as Json,
    description: 'Workspace-scoped admin sidebar navigation order.',
  })

  return normalized
}
