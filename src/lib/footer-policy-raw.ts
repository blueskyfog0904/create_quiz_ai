import { isConsentTextEmpty } from '@/lib/consent-text'
import {
  FOOTER_PRIVACY_POLICY_SLUG,
  getFooterPolicyDocumentDefault,
  getFooterPolicyDocumentKeyBySlug,
  type FooterPolicyDocumentKey,
} from '@/lib/footer-content'

// 가입 동의가 기대는 약관 원본 판정(4번 묶음). 정규화(normalizeFooterContent)는 빈 본문·오류를 코드 기본 약관으로 바꾸므로
// 동의 화면·하단 정보 저장 검사는 저장된(또는 화면이 보낸) 원본을 직접 본다.
// 규칙은 정규화와 맞춘다: slug → 문서 키는 코드 기본값, enabled 가 없으면 켜짐(false 일 때만 꺼짐), 본문은 공백 규칙으로 비었는지 본다.

export type RawFooterPolicyDocumentState =
  | { ok: true; key: FooterPolicyDocumentKey; slug: string; title: string; href: string }
  | { ok: false; reason: 'unknown_slug' | 'missing' | 'disabled' | 'empty' }

export function inspectRawFooterPolicyDocument(rawValue: unknown, slug: string): RawFooterPolicyDocumentState {
  const key = getFooterPolicyDocumentKeyBySlug(slug)
  if (!key) {
    return { ok: false, reason: 'unknown_slug' }
  }
  const documents = rawValue && typeof rawValue === 'object' && 'policyDocuments' in rawValue
    ? (rawValue as { policyDocuments?: unknown }).policyDocuments
    : null
  const document = documents && typeof documents === 'object'
    ? (documents as Record<string, unknown>)[key]
    : null
  if (!document || typeof document !== 'object') {
    return { ok: false, reason: 'missing' }
  }
  const record = document as Record<string, unknown>
  if (record.enabled === false) {
    return { ok: false, reason: 'disabled' }
  }
  if (isConsentTextEmpty(record.content)) {
    return { ok: false, reason: 'empty' }
  }
  const defaults = getFooterPolicyDocumentDefault(key)
  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : defaults.title
  return { ok: true, key, slug: defaults.slug, title, href: `/terms/${defaults.slug}` }
}

// 하단 정보 저장 검사: 보호 문서(활성 필수 동의 항목이 연결한 약관 + 개인정보처리방침)는 끄거나 본문을 비울 수 없다.
// 정규화 전 입력 원본으로 본다. 문제없으면 null, 아니면 화면에 보일 문구.
export function findProtectedFooterPolicyViolation(rawInput: unknown, protectedSlugs: string[]) {
  const slugs = Array.from(new Set([...protectedSlugs, FOOTER_PRIVACY_POLICY_SLUG]))
  for (const slug of slugs) {
    const state = inspectRawFooterPolicyDocument(rawInput, slug)
    if (!state.ok && state.reason !== 'unknown_slug') {
      const key = getFooterPolicyDocumentKeyBySlug(slug)
      const label = key ? getFooterPolicyDocumentDefault(key).label : slug
      return state.reason === 'disabled'
        ? `${label}은(는) 가입 동의에 쓰이는 문서라 끌 수 없습니다.`
        : `${label} 본문을 비울 수 없습니다(가입 동의에 쓰이는 문서입니다).`
    }
  }
  return null
}
