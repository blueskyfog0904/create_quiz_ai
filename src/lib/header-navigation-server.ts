import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_HEADER_NAVIGATION_CONFIG,
  HEADER_NAVIGATION_SETTING_KEY,
  normalizeHeaderNavigationConfig,
  type HeaderNavigationConfig,
} from '@/lib/header-navigation'
import {
  getGenerateChildrenSourceMode,
  listVisibleGenerateMenuEntries,
} from '@/lib/generate-menu-server'
import { mergeGenerateEntriesIntoHeaderConfig } from '@/lib/generate-menu'
import {
  getMarketChildrenSourceMode,
  listVisibleMarketMenuEntries,
} from '@/lib/market-menu-server'
import { mergeMarketEntriesIntoHeaderConfig } from '@/lib/market-menu'
import { preserveDbManagedParentChildren } from '@/lib/db-managed-header'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getWorkspaceSettingValue, upsertWorkspaceSetting, type WorkspaceSubject } from '@/lib/workspace-settings'
import type { Json, TablesInsert } from '@/types/supabase'

function getServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createAdminClient()
}

async function getLegacyHeaderNavigationConfig(): Promise<HeaderNavigationConfig> {
  const adminSupabase = getServiceRoleClient()

  if (!adminSupabase) {
    return DEFAULT_HEADER_NAVIGATION_CONFIG
  }

  const { data, error } = await adminSupabase
    .from('system_settings')
    .select('value')
    .eq('key', HEADER_NAVIGATION_SETTING_KEY)
    .maybeSingle()

  if (error || !data?.value) {
    return DEFAULT_HEADER_NAVIGATION_CONFIG
  }

  return normalizeHeaderNavigationConfig(data.value)
}

export async function getBaseHeaderNavigationConfig(
  workspaceSubject: WorkspaceSubject = 'english'
): Promise<HeaderNavigationConfig> {
  const workspaceValue = await getWorkspaceSettingValue<HeaderNavigationConfig | Json>(
    workspaceSubject,
    HEADER_NAVIGATION_SETTING_KEY
  )

  if (workspaceValue) {
    return normalizeHeaderNavigationConfig(workspaceValue)
  }

  if (workspaceSubject !== 'english') {
    return DEFAULT_HEADER_NAVIGATION_CONFIG
  }

  return getLegacyHeaderNavigationConfig()
}

export async function getHeaderNavigationConfig(
  workspaceSubject: WorkspaceSubject = 'english'
): Promise<HeaderNavigationConfig> {
  const baseConfig = await getBaseHeaderNavigationConfig(workspaceSubject)
  const generateEntries = await listVisibleGenerateMenuEntries()
  const marketEntries = await listVisibleMarketMenuEntries()

  return mergeMarketEntriesIntoHeaderConfig(
    mergeGenerateEntriesIntoHeaderConfig(
      baseConfig,
      generateEntries,
      getGenerateChildrenSourceMode()
    ),
    marketEntries,
    getMarketChildrenSourceMode()
  )
}

async function persistLegacyEnglishHeaderNavigationConfig(config: HeaderNavigationConfig) {
  const adminSupabase = getServiceRoleClient()

  const payload: TablesInsert<'system_settings'> = {
    key: HEADER_NAVIGATION_SETTING_KEY,
    value: config as unknown as Json,
    description: 'Header navigation configuration including logo text and up to 2-depth menu items.',
    updated_at: new Date().toISOString(),
  }

  if (adminSupabase) {
    const { error } = await adminSupabase
      .from('system_settings')
      .upsert(payload, { onConflict: 'key' })

    if (error) {
      throw new Error(error.message || '레거시 영어 헤더 메뉴 저장에 실패했습니다.')
    }

    return
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('system_settings')
    .upsert(payload, { onConflict: 'key' })

  if (error) {
    throw new Error(error.message || '레거시 영어 헤더 메뉴 저장에 실패했습니다.')
  }
}

export async function saveHeaderNavigationConfig(
  config: HeaderNavigationConfig,
  workspaceSubject: WorkspaceSubject = 'english'
) {
  const existingConfig = await getBaseHeaderNavigationConfig(workspaceSubject)
  const normalizedConfig = normalizeHeaderNavigationConfig(config)
  const preservedConfig = preserveDbManagedParentChildren(
    existingConfig,
    normalizedConfig,
    ['/generate', '/market']
  )

  await upsertWorkspaceSetting({
    workspaceSubject,
    settingKey: HEADER_NAVIGATION_SETTING_KEY,
    value: preservedConfig as unknown as Json,
    description: 'Workspace-scoped header navigation configuration including logo text and up to 2-depth menu items.',
  })

  if (workspaceSubject === 'english') {
    await persistLegacyEnglishHeaderNavigationConfig(preservedConfig)
  }

  return preservedConfig
}
