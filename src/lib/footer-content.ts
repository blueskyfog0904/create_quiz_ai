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

export type FooterFixedFieldKey = (typeof FOOTER_FIXED_FIELD_KEYS)[number]

export interface FooterFixedField {
  label: string
  value: string
  enabled: boolean
}

export interface FooterContentConfig {
  fixedFields: Record<FooterFixedFieldKey, FooterFixedField>
  extraNotices: string[]
}

export type SiteFooterContent = FooterContentConfig

export interface FooterDisplayField extends FooterFixedField {
  key: FooterFixedFieldKey
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

  return {
    fixedFields,
    extraNotices,
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

export function getSiteFooterDisplayRows(content?: Partial<FooterContentConfig> | Json | null) {
  const normalized = normalizeFooterContent(content)

  return {
    infoRows: getVisibleFooterRows(normalized).map((row) => row.map((field) => `${field.label}: ${field.value.trim()}`)),
    extraNotices: normalized.extraNotices,
    brandName: getFooterBrandName(normalized),
  }
}
