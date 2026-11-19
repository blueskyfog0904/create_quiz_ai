import type { Json } from '@/types/supabase'

// 사이트 기본 정보(사이트 이름·소개 문구). 헤더·브라우저 탭 제목·하단·약관 화면이 함께 쓴다.
// 값은 DB(system_settings)에만 두고, 관리자 "사이트 기본 정보" 화면에서 고친다.
export const SITE_BRAND_SETTING_KEY = 'site_brand'
export const SITE_BRAND_NAME_MAX_LENGTH = 40
export const SITE_BRAND_DESCRIPTION_MAX_LENGTH = 160

export interface SiteBrand {
  name: string
  description: string
}

export const EMPTY_SITE_BRAND: SiteBrand = { name: '', description: '' }

export function normalizeSiteBrand(input?: Partial<SiteBrand> | Json | null): SiteBrand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ...EMPTY_SITE_BRAND }
  }
  const value = input as Partial<Record<keyof SiteBrand, unknown>>
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, SITE_BRAND_NAME_MAX_LENGTH) : ''
  const description = typeof value.description === 'string'
    ? value.description.trim().slice(0, SITE_BRAND_DESCRIPTION_MAX_LENGTH)
    : ''
  return { name, description }
}

// 저장 전 검사. 사이트 이름은 비울 수 없다.
export function validateSiteBrand(input: SiteBrand): string | null {
  if (!input.name.trim()) return '사이트 이름을 입력해 주세요.'
  if (input.name.trim().length > SITE_BRAND_NAME_MAX_LENGTH) return `사이트 이름은 ${SITE_BRAND_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`
  if (input.description.trim().length > SITE_BRAND_DESCRIPTION_MAX_LENGTH) return `소개 문구는 ${SITE_BRAND_DESCRIPTION_MAX_LENGTH}자 이하로 입력해 주세요.`
  return null
}

// 브라우저 탭 제목: "화면 이름 | 사이트 이름". 사이트 이름이 없으면 화면 이름만.
export function buildSiteTitleTemplate(brand: SiteBrand) {
  return brand.name ? `%s | ${brand.name}` : '%s'
}
