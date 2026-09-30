import 'server-only'

import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/bypass'
import { MAIN_AD_IMAGES_BUCKET } from '@/lib/main-ad-carousel'
import { SITE_LOGO_SETTING_KEY } from '@/lib/site-logo'

const readSiteLogoUrl = unstable_cache(async (): Promise<string | null> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('system_settings')
    .select('value').eq('key', SITE_LOGO_SETTING_KEY).maybeSingle()
  if (error) throw error

  const value = data?.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const path = value.path
  if (typeof path !== 'string' || !/^site-logo\/[a-f0-9-]+\.png$/.test(path)) return null
  return supabase.storage.from(MAIN_AD_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
}, ['site-logo'], { revalidate: 60, tags: [SITE_LOGO_SETTING_KEY] })

export async function getSiteLogoUrl(): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    return await readSiteLogoUrl()
  } catch (error) {
    console.error('사이트 로고 조회에 실패했습니다.', error)
    return null
  }
}
