import 'server-only'

import { createAdminClient } from './supabase/bypass'
import {
  MAIN_AD_CAROUSEL_SETTING_KEY,
  MAIN_AD_IMAGES_BUCKET,
  getActiveMainAdCarouselItems,
  getDefaultMainAdCarouselConfig,
  normalizeMainAdCarouselConfig,
  resolveMainAdCarouselConfigForUpdate,
  validateMainAdCarouselConfig,
  type MainAdCarouselConfig,
  type MainAdCleanupWarning,
  type PublicMainAdCarouselItem,
} from './main-ad-carousel'
import type { Json, TablesInsert } from '@/types/supabase'

export interface MainAdCarouselAdminData {
  config: MainAdCarouselConfig
  imageUrls: Record<string, {
    pc: string
    mobile: string | null
  }>
}

function getServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createAdminClient()
}

function getPublicImageUrl(
  adminSupabase: ReturnType<typeof createAdminClient>,
  path: string
) {
  return adminSupabase.storage.from(MAIN_AD_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl
}

export function getMainAdCarouselImageUrls(
  config: MainAdCarouselConfig
): MainAdCarouselAdminData['imageUrls'] {
  const adminSupabase = getServiceRoleClient()

  if (!adminSupabase) {
    return {}
  }

  return Object.fromEntries(config.items.map((item) => [
    item.id,
    {
      pc: getPublicImageUrl(adminSupabase, item.pcImagePath),
      mobile: item.mobileImagePath
        ? getPublicImageUrl(adminSupabase, item.mobileImagePath)
        : null,
    },
  ]))
}

export async function getMainAdCarouselConfig(): Promise<MainAdCarouselConfig> {
  const adminSupabase = getServiceRoleClient()

  if (!adminSupabase) {
    return getDefaultMainAdCarouselConfig()
  }

  const { data, error } = await adminSupabase
    .from('system_settings')
    .select('value')
    .eq('key', MAIN_AD_CAROUSEL_SETTING_KEY)
    .maybeSingle()

  if (error || !data?.value) {
    return getDefaultMainAdCarouselConfig()
  }

  return normalizeMainAdCarouselConfig(data.value)
}

export async function getMainAdCarouselConfigForUpdate(): Promise<MainAdCarouselConfig> {
  const adminSupabase = getServiceRoleClient()

  if (!adminSupabase) {
    throw new Error('기존 메인 광고 설정 조회에 필요한 서비스 역할 키가 없습니다.')
  }

  const { data, error } = await adminSupabase
    .from('system_settings')
    .select('value')
    .eq('key', MAIN_AD_CAROUSEL_SETTING_KEY)
    .maybeSingle()

  if (error) {
    throw new Error(error.message || '기존 메인 광고 설정 조회에 실패했습니다.')
  }

  try {
    return resolveMainAdCarouselConfigForUpdate(data?.value, Boolean(data))
  } catch {
    throw new Error('기존 메인 광고 설정이 올바르지 않아 저장을 중단했습니다.')
  }
}

export async function getMainAdCarouselAdminData(): Promise<MainAdCarouselAdminData> {
  const config = await getMainAdCarouselConfig()

  return {
    config,
    imageUrls: getMainAdCarouselImageUrls(config),
  }
}

export async function getPublicMainAdCarouselItems(): Promise<PublicMainAdCarouselItem[]> {
  const adminSupabase = getServiceRoleClient()

  if (!adminSupabase) {
    return []
  }

  const config = await getMainAdCarouselConfig()

  return getActiveMainAdCarouselItems(config).map((item) => ({
    id: item.id,
    title: item.title,
    pcImageUrl: getPublicImageUrl(adminSupabase, item.pcImagePath),
    mobileImageUrl: item.mobileImagePath
      ? getPublicImageUrl(adminSupabase, item.mobileImagePath)
      : null,
    alt: item.alt,
    href: item.href,
    durationSeconds: item.durationSeconds,
  }))
}

export async function saveMainAdCarouselConfig(
  input: MainAdCarouselConfig
): Promise<MainAdCarouselConfig> {
  const adminSupabase = getServiceRoleClient()

  if (!adminSupabase) {
    throw new Error('메인 광고 설정 저장에 필요한 서비스 역할 키가 없습니다.')
  }

  const config = validateMainAdCarouselConfig(input)
  const payload: TablesInsert<'system_settings'> = {
    key: MAIN_AD_CAROUSEL_SETTING_KEY,
    value: config as unknown as Json,
    description: 'Solvook preview main advertisement carousel',
    updated_at: new Date().toISOString(),
  }

  const { error } = await adminSupabase
    .from('system_settings')
    .upsert(payload, { onConflict: 'key' })

  if (error) {
    throw new Error(error.message || '메인 광고 설정 저장에 실패했습니다.')
  }

  return config
}

export async function removeMainAdImagePaths(
  paths: Iterable<string>
): Promise<MainAdCleanupWarning[]> {
  const uniquePaths = [...new Set(paths)].filter(Boolean)
  if (uniquePaths.length === 0) {
    return []
  }

  const adminSupabase = getServiceRoleClient()
  if (!adminSupabase) {
    return uniquePaths.map((path) => ({
      path,
      message: '이미지 정리에 필요한 서비스 역할 키가 없습니다.',
    }))
  }

  try {
    const { error } = await adminSupabase
      .storage
      .from(MAIN_AD_IMAGES_BUCKET)
      .remove(uniquePaths)

    if (!error) {
      return []
    }

    return uniquePaths.map((path) => ({
      path,
      message: error.message || '사용하지 않는 이미지 삭제에 실패했습니다.',
    }))
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : '사용하지 않는 이미지 삭제에 실패했습니다.'

    return uniquePaths.map((path) => ({ path, message }))
  }
}
