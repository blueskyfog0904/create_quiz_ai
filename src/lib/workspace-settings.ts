import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'
export type { WorkspaceSubject } from '@/lib/workspace-subject'
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/types/supabase'


export const WORKSPACE_SETTINGS_TABLE = 'workspace_settings'

export const WORKSPACE_SETTING_KEYS = {
  headerNavigation: 'header_navigation',
  footerContent: 'footer_content',
  landingPage: 'landing_page',
  workspaceShell: 'workspace_shell',
} as const

export type WorkspaceSettingKey = (typeof WORKSPACE_SETTING_KEYS)[keyof typeof WORKSPACE_SETTING_KEYS]
export type WorkspaceSettingRow = Tables<'workspace_settings'>
export type WorkspaceSettingInsert = TablesInsert<'workspace_settings'>
export type WorkspaceSettingUpdate = TablesUpdate<'workspace_settings'>

function getServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createAdminClient()
}

async function getWorkspaceSettingsClient() {
  return getServiceRoleClient() ?? await createClient()
}

export function assertWorkspaceSubject(value: string): WorkspaceSubject {
  if (!isWorkspaceSubject(value)) {
    throw new Error(`Unsupported workspace subject: ${value}`)
  }

  return value
}

export async function getWorkspaceSettingRow(
  workspaceSubject: WorkspaceSubject,
  settingKey: WorkspaceSettingKey | string
): Promise<WorkspaceSettingRow | null> {
  const supabase = await getWorkspaceSettingsClient()
  const { data, error } = await supabase
    .from(WORKSPACE_SETTINGS_TABLE)
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .eq('setting_key', settingKey)
    .maybeSingle()

  if (error) {
    throw new Error(error.message || '워크스페이스 설정을 불러오지 못했습니다.')
  }

  return data
}

export async function getWorkspaceSettingValue<T = Json>(
  workspaceSubject: WorkspaceSubject,
  settingKey: WorkspaceSettingKey | string
): Promise<T | null> {
  const row = await getWorkspaceSettingRow(workspaceSubject, settingKey)
  return (row?.value as T | null) ?? null
}

export async function upsertWorkspaceSetting(input: {
  workspaceSubject: WorkspaceSubject
  settingKey: WorkspaceSettingKey | string
  value: Json
  description?: string | null
  updatedBy?: string | null
}): Promise<WorkspaceSettingRow> {
  const supabase = await getWorkspaceSettingsClient()

  const payload: WorkspaceSettingInsert = {
    workspace_subject: input.workspaceSubject,
    setting_key: input.settingKey,
    value: input.value,
    description: input.description ?? null,
    updated_by: input.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from(WORKSPACE_SETTINGS_TABLE)
    .upsert(payload, { onConflict: 'workspace_subject,setting_key' })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message || '워크스페이스 설정 저장에 실패했습니다.')
  }

  return data
}

export async function updateWorkspaceSetting(
  workspaceSubject: WorkspaceSubject,
  settingKey: WorkspaceSettingKey | string,
  input: Pick<WorkspaceSettingUpdate, 'value' | 'description' | 'updated_by'>
): Promise<WorkspaceSettingRow> {
  const supabase = await getWorkspaceSettingsClient()

  const payload: WorkspaceSettingUpdate = {
    value: input.value,
    description: input.description,
    updated_by: input.updated_by,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from(WORKSPACE_SETTINGS_TABLE)
    .update(payload)
    .eq('workspace_subject', workspaceSubject)
    .eq('setting_key', settingKey)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message || '워크스페이스 설정 수정에 실패했습니다.')
  }

  return data
}
