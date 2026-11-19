import 'server-only'

import { revalidateTag, unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  normalizeStorefrontHeaderLinks,
  STOREFRONT_HEADER_LINKS_SETTING_KEY,
  type StorefrontHeaderLink,
} from '@/lib/storefront-header-links'
import type { Json } from '@/types/supabase'

const readLinks = unstable_cache(async (): Promise<StorefrontHeaderLink[]> => {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('system_settings')
    .select('value').eq('key', STOREFRONT_HEADER_LINKS_SETTING_KEY).maybeSingle()
  if (error) throw error
  return normalizeStorefrontHeaderLinks(data?.value ?? null)
}, [STOREFRONT_HEADER_LINKS_SETTING_KEY], { revalidate: 60, tags: [STOREFRONT_HEADER_LINKS_SETTING_KEY] })

// 회원 헤더용: 켜 둔 링크만. 읽지 못하면 링크 없이 그린다(헤더는 깨지지 않는다).
export async function getActiveStorefrontHeaderLinks(): Promise<StorefrontHeaderLink[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return []
  try {
    return (await readLinks()).filter((link) => link.isActive)
  } catch (error) {
    console.error('상단 메뉴 링크 조회에 실패했습니다.', error)
    return []
  }
}

// 관리자 화면용: 캐시 없이 전부(꺼 둔 링크 포함) 읽고, 읽기 실패를 구분한다(실패하면 저장을 막는다).
export async function readStorefrontHeaderLinksForAdmin(): Promise<{ status: 'ok'; links: StorefrontHeaderLink[] } | { status: 'error' }> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.from('system_settings')
      .select('value').eq('key', STOREFRONT_HEADER_LINKS_SETTING_KEY).maybeSingle()
    if (error) return { status: 'error' }
    return { status: 'ok', links: normalizeStorefrontHeaderLinks(data?.value ?? null) }
  } catch {
    return { status: 'error' }
  }
}

export async function saveStorefrontHeaderLinks(links: StorefrontHeaderLink[]): Promise<StorefrontHeaderLink[]> {
  const normalized = normalizeStorefrontHeaderLinks({ links })
  const supabase = createAdminClient()
  const { error } = await supabase.from('system_settings').upsert({
    key: STOREFRONT_HEADER_LINKS_SETTING_KEY,
    value: { links: normalized } as unknown as Json,
    description: 'Member header (storefront) operator links',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' })
  if (error) throw new Error(error.message || '상단 메뉴 저장에 실패했습니다.')
  revalidateTag(STOREFRONT_HEADER_LINKS_SETTING_KEY, { expire: 0 })
  return normalized
}
