import type { Json } from '@/types/supabase'

export const SITE_FOOTER_CONTENT_SETTING_KEY = 'site_footer_content'
export const DEFAULT_FOOTER_BRAND_NAME = 'AI영어문제팩토리'

export const FOOTER_FIXED_FIELD_KEYS = [
  'companyName',
  'representativeName',
  'businessAddress',
  'businessRegistrationNumber',
  'mailOrderRegistrationNumber',
  'privacyOfficer',
  'customerCenter',
  'orderEmail',
  'csHours',
] as const

export const FOOTER_FIXED_FIELD_ORDER = FOOTER_FIXED_FIELD_KEYS

export const FOOTER_POLICY_DOCUMENT_KEYS = [
  'serviceTerms',
  'privacyPolicy',
  'refundPolicy',
] as const

export type FooterFixedFieldKey = (typeof FOOTER_FIXED_FIELD_KEYS)[number]
export type FooterPolicyDocumentKey = (typeof FOOTER_POLICY_DOCUMENT_KEYS)[number]

export interface FooterFixedField {
  label: string
  value: string
  enabled: boolean
}

export interface FooterPolicyDocument {
  label: string
  title: string
  slug: string
  content: string
  enabled: boolean
}

export interface FooterContentConfig {
  fixedFields: Record<FooterFixedFieldKey, FooterFixedField>
  extraNotices: string[]
  policyDocuments: Record<FooterPolicyDocumentKey, FooterPolicyDocument>
}

export type SiteFooterContent = FooterContentConfig

export interface FooterDisplayField extends FooterFixedField {
  key: FooterFixedFieldKey
}

export interface FooterPolicyDisplayLink {
  key: FooterPolicyDocumentKey
  label: string
  title: string
  slug: string
  href: string
}

const FOOTER_FIXED_FIELD_LABELS: Record<FooterFixedFieldKey, string> = {
  companyName: '상호명',
  representativeName: '대표자명',
  businessAddress: '사업장주소',
  businessRegistrationNumber: '사업자등록번호',
  mailOrderRegistrationNumber: '통신판매업 신고번호',
  privacyOfficer: '개인정보책임자',
  customerCenter: '고객센터',
  orderEmail: '상담/주문 이메일',
  csHours: 'CS 운영시간',
}

const DEFAULT_SERVICE_TERMS_CONTENT = `# 서비스 이용약관

## 제1조(목적)
본 약관은 회사가 제공하는 서비스의 이용조건, 절차, 회사와 회원 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.

## 제2조(서비스의 제공)
- AI 기반 중·고등학교 국어/영어 문제 생성 서비스
- 문제은행 기반 문제 제공 및 문제지 구성 기능
- 기타 회사가 정하는 서비스

## 제3조(회원가입 및 계정)
서비스 이용을 위해서는 카카오 등 소셜 로그인을 통한 회원가입이 필요합니다. 회원은 가입 시 제공하는 정보가 정확해야 하며, 허위 정보로 인한 불이익은 회원에게 있습니다.

## 제4조(회원의 의무)
회원은 타인의 정보 도용, 서비스 운영 방해, 저작권 침해, 불법·유해 정보 유포 등 관련 법령에 위반되거나 사회질서를 해치는 행위를 해서는 안 됩니다.

## 제5조(지식재산권 및 콘텐츠 이용)
회원이 서비스에 게시한 콘텐츠의 저작권은 회원에게 귀속됩니다. 다만 회사는 서비스 운영과 품질 개선에 필요한 범위에서 회원 콘텐츠를 이용할 수 있습니다.

## 제6조(면책 및 책임의 제한)
회사는 AI 생성 결과물의 정확성·완전성을 보증하지 않으며, 회원은 생성된 문제를 검토 후 이용해야 합니다.

## 제7조(준거법 및 분쟁해결)
본 약관은 대한민국 법령을 준거법으로 하며, 분쟁 발생 시 회사와 회원은 성실히 협의합니다.`

const DEFAULT_PRIVACY_POLICY_CONTENT = `# 개인정보처리방침

## 1. 개인정보의 처리 목적
회사는 회원 식별 및 서비스 제공, 공지·알림 등 커뮤니케이션, 서비스 개선 및 부정 이용 방지를 위해 개인정보를 처리합니다.

## 2. 처리하는 개인정보 항목
- 필수: 이메일 주소, 닉네임, 연락처(휴대폰 번호)
- 선택: 위치정보 제공 동의(위치 기반 기능 제공 시)

## 3. 개인정보의 보유 및 이용기간
원칙적으로 회원 탈퇴 시 지체 없이 파기합니다. 다만 관계 법령에 따라 보관이 필요한 경우 해당 법령에서 정한 기간 동안 보관할 수 있습니다.

## 4. 개인정보의 제3자 제공
회사는 원칙적으로 개인정보를 외부에 제공하지 않습니다. 다만 이용자가 사전에 동의한 경우 또는 법령에 근거한 적법한 요청이 있는 경우 예외로 합니다.

## 5. 개인정보 처리의 위탁
- 수탁자: Supabase
- 위탁 업무: 회원정보 관리 및 인증(로그인/계정)

## 6. 개인정보 보호책임자
- 개인정보 보호책임자: 관리자
- 이메일: thenaum2030@naver.com

## 7. 개인정보처리방침의 변경
본 방침의 내용 추가·삭제·정정이 있는 경우 시행 전 서비스 화면 또는 공지사항을 통해 고지합니다.`

const DEFAULT_REFUND_POLICY_CONTENT = `# 취소/환불정책

## 1. 환불 원칙
결제 후 즉시 크레딧이 충전되며, 환불은 미사용 크레딧에 한해 가능합니다.

## 2. 환불 가능 범위
- 결제 오류 또는 중복 결제가 확인된 경우
- 구매 후 사용하지 않은 크레딧이 남아 있는 경우
- 관련 법령 또는 회사 정책상 환불이 필요하다고 판단되는 경우

## 3. 환불 제한
이미 사용한 크레딧, 다운로드 또는 이용이 완료된 디지털 콘텐츠, 회원 귀책 사유로 가치가 훼손된 상품은 환불이 제한될 수 있습니다.

## 4. 환불 신청 및 처리
회원은 마이페이지 또는 고객센터를 통해 환불을 신청할 수 있습니다. 회사는 결제 내역과 사용 내역을 확인한 뒤 환불 가능 여부와 금액을 안내합니다.

## 5. 처리 기간
환불 승인 후 결제수단 및 결제대행사 정책에 따라 실제 환불 완료까지 영업일 기준 일정 기간이 소요될 수 있습니다.`

const FOOTER_POLICY_DOCUMENT_DEFAULTS: Record<FooterPolicyDocumentKey, FooterPolicyDocument> = {
  serviceTerms: {
    label: '서비스 이용약관',
    title: '서비스 이용약관',
    slug: 'service',
    content: DEFAULT_SERVICE_TERMS_CONTENT,
    enabled: true,
  },
  privacyPolicy: {
    label: '개인정보처리방침',
    title: '개인정보처리방침',
    slug: 'privacy',
    content: DEFAULT_PRIVACY_POLICY_CONTENT,
    enabled: true,
  },
  refundPolicy: {
    label: '취소/환불정책',
    title: '취소/환불정책',
    slug: 'refund',
    content: DEFAULT_REFUND_POLICY_CONTENT,
    enabled: true,
  },
}

export const FOOTER_FIXED_FIELD_ROWS: FooterFixedFieldKey[][] = [
  ['companyName', 'representativeName', 'businessAddress'],
  ['businessRegistrationNumber', 'mailOrderRegistrationNumber', 'privacyOfficer'],
  ['customerCenter', 'orderEmail', 'csHours'],
]

function createDefaultFixedField(key: FooterFixedFieldKey): FooterFixedField {
  return {
    label: FOOTER_FIXED_FIELD_LABELS[key],
    value: '',
    enabled: true,
  }
}

export function getDefaultFooterContent(): FooterContentConfig {
  return {
    fixedFields: Object.fromEntries(
      FOOTER_FIXED_FIELD_KEYS.map((key) => [key, createDefaultFixedField(key)])
    ) as Record<FooterFixedFieldKey, FooterFixedField>,
    extraNotices: [],
    policyDocuments: Object.fromEntries(
      FOOTER_POLICY_DOCUMENT_KEYS.map((key) => [key, { ...FOOTER_POLICY_DOCUMENT_DEFAULTS[key] }])
    ) as Record<FooterPolicyDocumentKey, FooterPolicyDocument>,
  }
}

export function normalizeFooterContent(
  input?: Partial<FooterContentConfig> | Json | null
): FooterContentConfig {
  const defaults = getDefaultFooterContent()
  const inputFields = (
    input
    && typeof input === 'object'
    && 'fixedFields' in input
    && input.fixedFields
    && typeof input.fixedFields === 'object'
  )
    ? input.fixedFields as Partial<Record<FooterFixedFieldKey, Partial<FooterFixedField> | null>>
    : {}

  const fixedFields = Object.fromEntries(
    FOOTER_FIXED_FIELD_KEYS.map((key) => {
      const value = inputFields[key]
      return [key, {
        label: value?.label?.trim() || defaults.fixedFields[key].label,
        value: typeof value?.value === 'string' ? value.value : defaults.fixedFields[key].value,
        enabled: typeof value?.enabled === 'boolean' ? value.enabled : defaults.fixedFields[key].enabled,
      }]
    })
  ) as Record<FooterFixedFieldKey, FooterFixedField>

  const rawExtraNotices = (
    input
    && typeof input === 'object'
    && 'extraNotices' in input
    && Array.isArray(input.extraNotices)
  )
    ? input.extraNotices as unknown[]
    : []

  const extraNotices = rawExtraNotices
    .filter((notice): notice is string => typeof notice === 'string')
    .map((notice) => notice.trim())
    .filter(Boolean)

  const inputPolicyDocuments = (
    input
    && typeof input === 'object'
    && 'policyDocuments' in input
    && input.policyDocuments
    && typeof input.policyDocuments === 'object'
  )
    ? input.policyDocuments as Partial<Record<FooterPolicyDocumentKey, Partial<FooterPolicyDocument> | null>>
    : {}

  const policyDocuments = Object.fromEntries(
    FOOTER_POLICY_DOCUMENT_KEYS.map((key) => {
      const defaultsForKey = defaults.policyDocuments[key]
      const value = inputPolicyDocuments[key]

      return [key, {
        label: value?.label?.trim() || defaultsForKey.label,
        title: value?.title?.trim() || defaultsForKey.title,
        slug: defaultsForKey.slug,
        content: typeof value?.content === 'string' && value.content.trim()
          ? value.content
          : defaultsForKey.content,
        enabled: typeof value?.enabled === 'boolean' ? value.enabled : defaultsForKey.enabled,
      }]
    })
  ) as Record<FooterPolicyDocumentKey, FooterPolicyDocument>

  return {
    fixedFields,
    extraNotices,
    policyDocuments,
  }
}

export const normalizeSiteFooterContent = normalizeFooterContent
export const getDefaultSiteFooterContent = getDefaultFooterContent

export function getVisibleFooterRows(config: FooterContentConfig): FooterDisplayField[][] {
  return FOOTER_FIXED_FIELD_ROWS
    .map((row) => row
      .map((key) => ({ key, ...config.fixedFields[key] }))
      .filter((field) => field.enabled && field.value.trim()))
    .filter((row) => row.length > 0)
}

export function getFooterBrandName(config: FooterContentConfig) {
  const companyName = config.fixedFields.companyName

  if (companyName.enabled && companyName.value.trim()) {
    return companyName.value.trim()
  }

  return DEFAULT_FOOTER_BRAND_NAME
}

export function getVisibleFooterPolicyLinks(config: FooterContentConfig): FooterPolicyDisplayLink[] {
  return FOOTER_POLICY_DOCUMENT_KEYS
    .map((key) => ({ key, ...config.policyDocuments[key] }))
    .filter((document) => document.enabled && document.label.trim() && document.content.trim())
    .map((document) => ({
      key: document.key,
      label: document.label.trim(),
      title: document.title.trim(),
      slug: document.slug,
      href: `/terms/${document.slug}`,
    }))
}

export function getFooterPolicyDocumentBySlug(config: FooterContentConfig, slug: string) {
  const normalizedSlug = slug.trim()
  const document = FOOTER_POLICY_DOCUMENT_KEYS
    .map((key) => ({ key, ...config.policyDocuments[key] }))
    .find((candidate) => candidate.slug === normalizedSlug)

  if (!document || !document.enabled || !document.content.trim()) {
    return null
  }

  return {
    key: document.key,
    label: document.label.trim(),
    title: document.title.trim(),
    slug: document.slug,
    href: `/terms/${document.slug}`,
    content: document.content,
  }
}

export function getSiteFooterDisplayRows(content?: Partial<FooterContentConfig> | Json | null) {
  const normalized = normalizeFooterContent(content)

  return {
    infoRows: getVisibleFooterRows(normalized).map((row) => row.map((field) => `${field.label}: ${field.value.trim()}`)),
    extraNotices: normalized.extraNotices,
    policyLinks: getVisibleFooterPolicyLinks(normalized),
    brandName: getFooterBrandName(normalized),
  }
}
