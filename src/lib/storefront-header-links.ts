import type { Json } from '@/types/supabase'

// 회원 화면 헤더 오른쪽(2단 메뉴)의 운영 링크(예: 크레딧 충전, 이벤트 안내).
// 카테고리·국어·영어 탭은 화면 구조라 코드에 두고, 운영자가 바꾸는 링크만 DB(system_settings)에 둔다.
export const STOREFRONT_HEADER_LINKS_SETTING_KEY = 'storefront_header_links'
export const STOREFRONT_HEADER_LINK_MAX_COUNT = 5
export const STOREFRONT_HEADER_LINK_LABEL_MAX_LENGTH = 20
export const STOREFRONT_HEADER_LINK_HREF_MAX_LENGTH = 300

export interface StorefrontHeaderLink {
  label: string
  href: string
  isActive: boolean
  // 강조: 보라색 글씨와 아이콘(지금의 "크레딧 충전" 모양)
  emphasis: boolean
}

// 사이트 안 주소(/로 시작, //는 아님) 또는 https 주소만 받는다.
// 사이트 안 주소에 역슬래시·공백·제어문자가 있으면 브라우저가 '//'(다른 사이트)로 해석할 수 있어 막는다.
const INTERNAL_HREF_PATTERN = /^\/(?!\/)[^\s\\\u0000-\u001f\u007f]*$/

export function isAllowedStorefrontHref(href: string) {
  const value = href.trim()
  if (!value || value.length > STOREFRONT_HEADER_LINK_HREF_MAX_LENGTH) return false
  if (value.startsWith('/')) return INTERNAL_HREF_PATTERN.test(value)
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function isExternalStorefrontHref(href: string) {
  return !href.trim().startsWith('/')
}

export function normalizeStorefrontHeaderLinks(input?: unknown | Json | null): StorefrontHeaderLink[] {
  const raw = input && typeof input === 'object' && !Array.isArray(input) && Array.isArray((input as { links?: unknown }).links)
    ? (input as { links: unknown[] }).links
    : []
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      label: typeof entry.label === 'string' ? entry.label.trim().slice(0, STOREFRONT_HEADER_LINK_LABEL_MAX_LENGTH) : '',
      href: typeof entry.href === 'string' ? entry.href.trim() : '',
      isActive: entry.isActive !== false,
      emphasis: entry.emphasis === true,
    }))
    .filter((link) => link.label && isAllowedStorefrontHref(link.href))
    .slice(0, STOREFRONT_HEADER_LINK_MAX_COUNT)
}

// 저장 전 검사(빈 이름·허용하지 않는 주소·개수). 통과하면 null.
export function validateStorefrontHeaderLinks(links: StorefrontHeaderLink[]): string | null {
  if (links.length > STOREFRONT_HEADER_LINK_MAX_COUNT) return `링크는 ${STOREFRONT_HEADER_LINK_MAX_COUNT}개까지 둘 수 있습니다.`
  for (const [index, link] of links.entries()) {
    const label = link.label.trim()
    if (!label) return `${index + 1}번째 링크의 이름을 입력해 주세요.`
    if (label.length > STOREFRONT_HEADER_LINK_LABEL_MAX_LENGTH) return `${index + 1}번째 링크 이름은 ${STOREFRONT_HEADER_LINK_LABEL_MAX_LENGTH}자 이하로 입력해 주세요.`
    if (!isAllowedStorefrontHref(link.href)) return `${index + 1}번째 링크 주소는 /로 시작하는 사이트 주소나 https:// 주소여야 합니다.`
  }
  return null
}
