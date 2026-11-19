import 'server-only'

import { revalidateTag, unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/bypass'
import { normalizeSiteBrand, SITE_BRAND_SETTING_KEY, type SiteBrand } from '@/lib/site-brand'
import type { Json } from '@/types/supabase'

const readSiteBrand = unstable_cache(async (): Promise<SiteBrand> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('system_settings')
    .select('value').eq('key', SITE_BRAND_SETTING_KEY).maybeSingle()
  if (error) throw error
  return normalizeSiteBrand(data?.value ?? null)
}, [SITE_BRAND_SETTING_KEY], { revalidate: 60, tags: [SITE_BRAND_SETTING_KEY] })

// 읽지 못하면 빈 값(사이트 이름 없이 화면 이름만 보임)으로 둔다. 코드에 사이트 이름을 두지 않는다.
export async function getSiteBrand(): Promise<SiteBrand> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return normalizeSiteBrand(null)
  try {
    return await readSiteBrand()
  } catch (error) {
    console.error('사이트 기본 정보 조회에 실패했습니다.', error)
    return normalizeSiteBrand(null)
  }
}

// 관리자 화면용: 캐시 없이 읽고, 읽기 실패를 구분한다(실패하면 저장 버튼을 막는다).
export async function readSiteBrandForAdmin(): Promise<{ status: 'ok'; brand: SiteBrand } | { status: 'error' }> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.from('system_settings')
      .select('value').eq('key', SITE_BRAND_SETTING_KEY).maybeSingle()
    if (error) return { status: 'error' }
    return { status: 'ok', brand: normalizeSiteBrand(data?.value ?? null) }
  } catch {
    return { status: 'error' }
  }
}

export async function saveSiteBrand(brand: SiteBrand): Promise<SiteBrand> {
  const normalized = normalizeSiteBrand(brand)
  const supabase = createAdminClient()
  const { error } = await supabase.from('system_settings').upsert({
    key: SITE_BRAND_SETTING_KEY,
    value: normalized as unknown as Json,
    description: 'Site brand name and description (header, tab title, footer)',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })
  if (error) throw new Error(error.message || '사이트 기본 정보 저장에 실패했습니다.')
  revalidateTag(SITE_BRAND_SETTING_KEY, { expire: 0 })
  return normalized
}
