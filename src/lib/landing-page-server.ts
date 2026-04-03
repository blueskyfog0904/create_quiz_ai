import { createAdminClient } from './supabase/bypass'
import {
  getDefaultMainLandingConfig,
  getDefaultWorkspaceLandingConfig,
  normalizeMainLandingConfig,
  normalizeWorkspaceLandingConfig,
  validateMainLandingConfig,
  validateWorkspaceLandingConfig,
  type MainLandingConfig,
  type WorkspaceLandingConfig,
} from './landing-page'
import {
  WORKSPACE_SETTING_KEYS,
  getWorkspaceSettingValue,
  upsertWorkspaceSetting,
} from './workspace-settings'
import type { Json, TablesInsert } from '@/types/supabase'
import type { WorkspaceSubject } from './workspace-subject'

export const MAIN_LANDING_SETTING_KEY = 'main_landing_page'

function getServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createAdminClient()
}

export async function getMainLandingConfig(): Promise<MainLandingConfig> {
  const adminSupabase = getServiceRoleClient()

  if (!adminSupabase) {
    return getDefaultMainLandingConfig()
  }

  const { data, error } = await adminSupabase
    .from('system_settings')
    .select('value')
    .eq('key', MAIN_LANDING_SETTING_KEY)
    .maybeSingle()

  if (error || !data?.value) {
    return getDefaultMainLandingConfig()
  }

  return normalizeMainLandingConfig(data.value)
}

export async function saveMainLandingConfig(
  input: MainLandingConfig
): Promise<MainLandingConfig> {
  const adminSupabase = getServiceRoleClient()

  if (!adminSupabase) {
    throw new Error('메인 랜딩 설정 저장에 필요한 서비스 역할 키가 없습니다.')
  }

  const nextValue = validateMainLandingConfig(input)

  const payload: TablesInsert<'system_settings'> = {
    key: MAIN_LANDING_SETTING_KEY,
    value: nextValue as unknown as Json,
    description: 'Main landing page configuration',
    updated_at: new Date().toISOString(),
  }

  const { error } = await adminSupabase
    .from('system_settings')
    .upsert(payload, { onConflict: 'key' })

  if (error) {
    throw new Error(error.message || '메인 랜딩 설정 저장에 실패했습니다.')
  }

  return nextValue
}

export async function getWorkspaceLandingConfig(subject: WorkspaceSubject): Promise<WorkspaceLandingConfig> {
  const value = await getWorkspaceSettingValue<WorkspaceLandingConfig | Json>(
    subject,
    WORKSPACE_SETTING_KEYS.landingPage
  )

  if (!value) {
    return getDefaultWorkspaceLandingConfig(subject)
  }

  return normalizeWorkspaceLandingConfig(subject, value)
}

export async function saveWorkspaceLandingConfig(
  subject: WorkspaceSubject,
  input: WorkspaceLandingConfig,
  updatedBy?: string | null
): Promise<WorkspaceLandingConfig> {
  const nextValue = validateWorkspaceLandingConfig(input)

  await upsertWorkspaceSetting({
    workspaceSubject: subject,
    settingKey: WORKSPACE_SETTING_KEYS.landingPage,
    value: nextValue as unknown as Json,
    description: 'Workspace landing page configuration',
    updatedBy,
  })

  return nextValue
}
