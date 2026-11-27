import 'server-only'

import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/bypass'
import { MAIN_AD_IMAGES_BUCKET } from '@/lib/main-ad-carousel'
import { SITE_LOGO_SETTING_KEY, SITE_TAB_ICON_SETTING_KEY } from '@/lib/site-logo'

// 설정 행(system_settings)에 적힌 저장 경로를 공개 주소로 바꾼다. 경로 모양이 다르면 없는 것으로 본다.
async function readSettingImageUrl(key: string, pathPattern: RegExp): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('system_settings')
    .select('value').eq('key', key).maybeSingle()
  if (error) throw error

  const value = data?.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const path = value.path
  if (typeof path !== 'string' || !pathPattern.test(path)) return null
  return supabase.storage.from(MAIN_AD_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
}

const readSiteLogoUrl = unstable_cache(
  () => readSettingImageUrl(SITE_LOGO_SETTING_KEY, /^site-logo\/[a-f0-9-]+\.png$/),
  ['site-logo'], { revalidate: 60, tags: [SITE_LOGO_SETTING_KEY] },
)

const readSiteTabIconUrl = unstable_cache(
  () => readSettingImageUrl(SITE_TAB_ICON_SETTING_KEY, /^site-tab-icon\/[a-f0-9-]+\.png$/),
  ['site-tab-icon'], { revalidate: 60, tags: [SITE_TAB_ICON_SETTING_KEY] },
)

async function readOrNull(read: () => Promise<string | null>, failureMessage: string): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    return await read()
  } catch (error) {
    console.error(failureMessage, error)
    return null
  }
}

export async function getSiteLogoUrl(): Promise<string | null> {
  return readOrNull(readSiteLogoUrl, '사이트 로고 조회에 실패했습니다.')
}

// 관리자에서 따로 올린 탭 아이콘. 없으면 null(쓰는 쪽이 사이트 로고로 대신한다).
export async function getSiteTabIconUrl(): Promise<string | null> {
  return readOrNull(readSiteTabIconUrl, '탭 아이콘 조회에 실패했습니다.')
}
