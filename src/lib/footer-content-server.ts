import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  getDefaultFooterContent,
  normalizeFooterContent,
  SITE_FOOTER_CONTENT_SETTING_KEY,
  type FooterContentConfig,
} from '@/lib/footer-content'
import type { Json, TablesInsert } from '@/types/supabase'

function getServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createAdminClient()
}

export async function getSiteFooterContent(): Promise<FooterContentConfig> {
  const adminSupabase = getServiceRoleClient()

  if (!adminSupabase) {
    return getDefaultFooterContent()
  }

  const { data, error } = await adminSupabase
    .from('system_settings')
    .select('value')
    .eq('key', SITE_FOOTER_CONTENT_SETTING_KEY)
    .maybeSingle()

  if (error || !data?.value) {
    return getDefaultFooterContent()
  }

  return normalizeFooterContent(data.value as FooterContentConfig | Json)
}

export async function saveSiteFooterContent(
  input: FooterContentConfig
): Promise<FooterContentConfig> {
  const nextValue = normalizeFooterContent(input)
  const adminSupabase = getServiceRoleClient() ?? await createClient()

  const payload: TablesInsert<'system_settings'> = {
    key: SITE_FOOTER_CONTENT_SETTING_KEY,
    value: nextValue as unknown as Json,
    description: 'Site-wide footer content configuration',
    updated_at: new Date().toISOString(),
  }

  const { error } = await adminSupabase
    .from('system_settings')
    .upsert(payload, { onConflict: 'key' })

  if (error) {
    throw new Error(error.message || 'Footer 설정 저장에 실패했습니다.')
  }

  return nextValue
}
