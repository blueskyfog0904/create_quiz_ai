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
import { createAdminClient } from '@/lib/supabase/bypass'
import type { Json, TablesInsert } from '@/types/supabase'

function getServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createAdminClient()
}

export async function getBaseHeaderNavigationConfig(): Promise<HeaderNavigationConfig> {
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

export async function getHeaderNavigationConfig(): Promise<HeaderNavigationConfig> {
  const baseConfig = await getBaseHeaderNavigationConfig()
  const generateEntries = await listVisibleGenerateMenuEntries()

  return mergeGenerateEntriesIntoHeaderConfig(
    baseConfig,
    generateEntries,
    getGenerateChildrenSourceMode()
  )
}

export async function saveHeaderNavigationConfig(config: HeaderNavigationConfig) {
  const adminSupabase = getServiceRoleClient()
  const existingConfig = await getBaseHeaderNavigationConfig()
  const normalizedConfig = normalizeHeaderNavigationConfig(config)
  const existingGenerateParent = existingConfig.items.find((item) => item.href === '/generate')

  const preservedConfig = {
    ...normalizedConfig,
    items: normalizedConfig.items.map((item) => {
      if (item.href !== '/generate') {
        return item
      }

      return {
        ...item,
        children: existingGenerateParent?.children ?? item.children,
      }
    }),
  }

  const payload: TablesInsert<'system_settings'> = {
    key: HEADER_NAVIGATION_SETTING_KEY,
    value: preservedConfig as unknown as Json,
    description: 'Header navigation configuration including logo text and up to 2-depth menu items.',
    updated_at: new Date().toISOString(),
  }

  if (adminSupabase) {
    const { error } = await adminSupabase
      .from('system_settings')
      .upsert(payload, { onConflict: 'key' })

    if (error) {
      throw new Error(error.message || '헤더 메뉴 저장에 실패했습니다.')
    }

    return preservedConfig
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('system_settings')
    .upsert(payload, { onConflict: 'key' })

  if (error) {
    throw new Error(error.message || '헤더 메뉴 저장에 실패했습니다.')
  }

  return preservedConfig
}
