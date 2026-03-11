import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_HEADER_NAVIGATION_CONFIG,
  HEADER_NAVIGATION_SETTING_KEY,
  normalizeHeaderNavigationConfig,
  type HeaderNavigationConfig,
} from '@/lib/header-navigation'

function getServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function getHeaderNavigationConfig(): Promise<HeaderNavigationConfig> {
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

export async function saveHeaderNavigationConfig(config: HeaderNavigationConfig) {
  const adminSupabase = getServiceRoleClient()
  const normalizedConfig = normalizeHeaderNavigationConfig(config)

  if (adminSupabase) {
    const { error } = await adminSupabase
      .from('system_settings')
      .upsert(
        {
          key: HEADER_NAVIGATION_SETTING_KEY,
          value: normalizedConfig,
          description: 'Header navigation configuration including logo text and up to 2-depth menu items.',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      )

    if (error) {
      throw new Error(error.message || '헤더 메뉴 저장에 실패했습니다.')
    }

    return normalizedConfig
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('system_settings')
    .upsert(
      {
        key: HEADER_NAVIGATION_SETTING_KEY,
        value: normalizedConfig,
        description: 'Header navigation configuration including logo text and up to 2-depth menu items.',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    )

  if (error) {
    throw new Error(error.message || '헤더 메뉴 저장에 실패했습니다.')
  }

  return normalizedConfig
}
