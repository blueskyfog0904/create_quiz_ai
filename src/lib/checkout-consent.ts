import { POINT_CHARGE_VALIDITY_YEARS } from '@/lib/point-charge-policy'

// 11번 묶음(계획 docs/plan-bundle11-checkout-simplify.md 4~5절): 결제 화면 동의 2판(접는 동의) 문구 검사·원문·묶음.
// 화면·서버·관리자 화면이 같이 쓰는 순수 모듈이다(요청·DB 없음). 지문(sha256)은 서버만 계산한다(checkout-consent-server.ts).
// 같은 규칙을 DB 함수 build_checkout_consent_v2·build_market_cart_texts 가 SQL 로 다시 한다(마이그레이션 20261216100000).
// 판(consentFormat)은 version 과 따로 둔다: 없거나 1 → 1판, 2 → 2판, 그 밖 → 결제 닫힘.

export type CheckoutConsentKind = 'market' | 'point_charge'
export type CheckoutConsentFormat = 1 | 2

export const CHECKOUT_CONSENT_LINK_KEYS = ['refundPolicy', 'serviceTerms'] as const
export type CheckoutConsentLinkKey = (typeof CHECKOUT_CONSENT_LINK_KEYS)[number]

export const CHECKOUT_CONSENT_TITLE_MAX = 26
export const CHECKOUT_CONSENT_SUMMARY_LINE_MAX = 120
export const CHECKOUT_CONSENT_MARKET_SUMMARY_TOTAL_MAX = 220
export const CHECKOUT_CONSENT_ITEMS_MAX = 6
export const CHECKOUT_CONSENT_ITEM_LABEL_MAX = 30
export const CHECKOUT_CONSENT_TEXT_KEYS_MAX = 6
export const MARKET_CART_TEXT_MAX = 300
export const CHECKOUT_CONSENT_REQUIRED_MARK = '[필수]'
export const CHECKOUT_CONSENT_LINK_PREFIX = '링크:'

export const MARKET_REFUND_PERIOD_PLACEHOLDER = '{자료환불기간}'
export const POINT_CHARGE_REFUND_PERIOD_PLACEHOLDER = '{충전환불기간}'
export const POINT_CHARGE_VALIDITY_PLACEHOLDER = '{충전유효기간}'

export interface CheckoutConsentSummaryRole {
  role: string
  required: boolean
  // 이 줄에 꼭 들어가야 하는 자리표시
  placeholders: string[]
}

export interface CheckoutConsentSpec {
  summaryRoles: CheckoutConsentSummaryRole[]
  summaryTotalMax: number | null
  placeholders: string[]
  // 항목이 가리킬 수 있는 본문(4-3 (e)). 이 목록 밖은 가리킬 수 없다.
  textTargets: string[]
  // 항목들이 꼭 가리켜야 하는 본문(4-3 (f)). 두 링크도 꼭 있어야 한다.
  requiredTargets: string[]
}

export const CHECKOUT_CONSENT_SPECS: Record<CheckoutConsentKind, CheckoutConsentSpec> = {
  market: {
    summaryRoles: [
      { role: 'refundPeriod', required: true, placeholders: [MARKET_REFUND_PERIOD_PLACEHOLDER] },
      { role: 'restriction', required: true, placeholders: [] },
      { role: 'note', required: false, placeholders: [] },
    ],
    summaryTotalMax: CHECKOUT_CONSENT_MARKET_SUMMARY_TOTAL_MAX,
    placeholders: [MARKET_REFUND_PERIOD_PLACEHOLDER],
    textTargets: ['confirmNotice', 'usageScopeNotice', 'downloadPeriodNotice'],
    requiredTargets: ['confirmNotice'],
  },
  point_charge: {
    summaryRoles: [
      { role: 'refundPeriod', required: true, placeholders: [POINT_CHARGE_REFUND_PERIOD_PLACEHOLDER] },
      { role: 'restriction', required: true, placeholders: [] },
      { role: 'validity', required: true, placeholders: [POINT_CHARGE_VALIDITY_PLACEHOLDER] },
      { role: 'minor', required: true, placeholders: [] },
      { role: 'note', required: false, placeholders: [] },
    ],
    summaryTotalMax: null,
    placeholders: [POINT_CHARGE_REFUND_PERIOD_PLACEHOLDER, POINT_CHARGE_VALIDITY_PLACEHOLDER],
    textTargets: [
      'checkoutItems.product',
      'checkoutItems.validity',
      'checkoutItems.refund',
      'checkoutItems.restriction',
      'checkoutItems.otherCases',
      'minorNotice',
    ],
    requiredTargets: [
      'checkoutItems.product',
      'checkoutItems.validity',
      'checkoutItems.refund',
      'checkoutItems.restriction',
      'checkoutItems.otherCases',
      'minorNotice',
    ],
  },
}

export interface CheckoutConsentTextItem {
  key: string
  label: string
  view: 'text'
  texts: string[]
}

export interface CheckoutConsentLinkItem {
  key: string
  label: string
  view: 'link'
  link: CheckoutConsentLinkKey
}

export type CheckoutConsentItem = CheckoutConsentTextItem | CheckoutConsentLinkItem

// 화면으로 보내는 2판 묶음(5-2). DB 응답·서버 계산이 같은 값이다. 1판 키는 넣지 않는다.
export interface CheckoutConsentBundle {
  consentFormat: 2
  consentTitle: string
  consentSummary: string[]
  consentItems: CheckoutConsentItem[]
  noticeSha256: string
  refundDays: number
}

export type CheckoutConsentBundleDraft = Omit<CheckoutConsentBundle, 'noticeSha256'>

// 저장된(DB) 항목 모양
export type CheckoutConsentRawItem =
  | { key: string; label: string; view: 'text'; textKeys: string[] }
  | { key: string; label: string; view: 'link'; link: CheckoutConsentLinkKey }

export interface CheckoutConsentProblem {
  // 걸린 칸(관리자 화면이 짚어 알림): consentTitle, consentSummary.<role>, consentSummary, consentItems, consentItems.<n>.label,
  // consentItems.<n>.textKeys, consentItems.<n>.link, body:<target>, cartCheckoutNotice, partialOwnedConfirmLabel
  field: string
  message: string
}

// 장바구니 결제 칸 문구(5-4). 동의 원문에는 넣지 않고 따로 지문으로 대조한다.
export const MARKET_CART_TEXT_KEYS = ['cartCheckoutNotice', 'partialOwnedConfirmLabel'] as const
export type MarketCartTextKey = (typeof MARKET_CART_TEXT_KEYS)[number]

export interface MarketCartTexts {
  cartCheckoutNotice: string
  partialOwnedConfirmLabel: string
  cartTextsSha256: string
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const ITEM_KEY_PATTERN = /^[a-z][A-Za-z0-9]{0,29}$/
const NOT_BLANK_PATTERN = /[^ \t\n\r]/
// 4-3 (c): 기간 숫자 금지(제목·요약 줄·항목 이름, 채우기 전). SQL 과 같은 식.
const DIGIT_PATTERN = /[0-9０-９]/
const KOREAN_NUMBER_PERIOD_PATTERN = /([일이삼사오육칠팔구십백]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른)[ \t\n]*(일째|일|년|개월|달|주일|주|시간)/
const KOREAN_PERIOD_WORD_PATTERN = /(하루|이틀|사흘|나흘|열흘|보름|한 해)/

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function charLength(text: string): number {
  return [...text].length
}

function isNotBlank(text: string): boolean {
  return NOT_BLANK_PATTERN.test(text)
}

export function hasPeriodNumber(text: string): boolean {
  return DIGIT_PATTERN.test(text) || KOREAN_NUMBER_PERIOD_PATTERN.test(text) || KOREAN_PERIOD_WORD_PATTERN.test(text)
}

// 판 읽기(4-1): 키가 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖(글자 "2", 2.5, 3, null) → null(결제 닫힘).
export function readCheckoutConsentFormat(value: unknown): CheckoutConsentFormat | null {
  const record = asRecord(value)
  if (!record) return null
  if (!Object.hasOwn(record, 'consentFormat')) return 1
  const format = record.consentFormat
  if (format === 1) return 1
  if (format === 2) return 2
  return null
}

// 2판 키(consentTitle·consentSummary·consentItems) 중 하나라도 있으면 2판 문구가 있는 것으로 본다(관리자 화면이 늘 검사).
export function hasCheckoutConsentKeys(value: unknown): boolean {
  const record = asRecord(value)
  return Boolean(record && (Object.hasOwn(record, 'consentTitle') || Object.hasOwn(record, 'consentSummary') || Object.hasOwn(record, 'consentItems')))
}

// 자리표시 채우기(5-1): 자료 {자료환불기간}→D, 충전 {충전환불기간}→D 다음 {충전유효기간}→Y. SQL replace() 와 같은 결과.
export function fillCheckoutConsentText(kind: CheckoutConsentKind, text: string, refundDays: number): string {
  if (kind === 'market') {
    return text.split(MARKET_REFUND_PERIOD_PLACEHOLDER).join(String(refundDays))
  }
  return text
    .split(POINT_CHARGE_REFUND_PERIOD_PLACEHOLDER).join(String(refundDays))
    .split(POINT_CHARGE_VALIDITY_PLACEHOLDER).join(String(POINT_CHARGE_VALIDITY_YEARS))
}

// 자리표시를 뺀 뒤 중괄호가 남는지(= 채운 뒤 중괄호가 남는지, 기간은 숫자라서 같다).
function hasStrayBraces(kind: CheckoutConsentKind, text: string): boolean {
  let rest = text
  for (const placeholder of CHECKOUT_CONSENT_SPECS[kind].placeholders) rest = rest.split(placeholder).join('')
  return /[{}]/.test(rest)
}

// 가리킬 수 있는 본문 읽기(4-3 (e)): 정해진 잎만, 일반 경로 풀이는 하지 않는다.
export function readCheckoutConsentTarget(kind: CheckoutConsentKind, value: unknown, target: string): unknown {
  const record = asRecord(value)
  if (!record || !CHECKOUT_CONSENT_SPECS[kind].textTargets.includes(target)) return undefined
  if (kind === 'point_charge' && target.startsWith('checkoutItems.')) {
    const items = asRecord(record.checkoutItems)
    return items ? items[target.slice('checkoutItems.'.length)] : undefined
  }
  return record[target]
}

interface StringRuleOptions {
  oneLine: boolean
  min: number
  max: number
  periodNumberForbidden: boolean
}

function checkConsentString(kind: CheckoutConsentKind, field: string, label: string, value: unknown, options: StringRuleOptions,
  problems: CheckoutConsentProblem[]): value is string {
  if (typeof value !== 'string') {
    problems.push({ field, message: `${label}을(를) 입력해 주세요.` })
    return false
  }
  if (!isNotBlank(value)) {
    problems.push({ field, message: `${label}을(를) 입력해 주세요.` })
    return false
  }
  const length = charLength(value)
  if (length < options.min || length > options.max) {
    problems.push({ field, message: `${label}은(는) ${options.max}자 이하로 입력해 주세요(지금 ${length}자).` })
    return false
  }
  if (options.oneLine && value.includes('\n')) {
    problems.push({ field, message: `${label}은(는) 한 줄로 입력해 주세요(줄바꿈 없음).` })
    return false
  }
  if (hasStrayBraces(kind, value)) {
    problems.push({ field, message: `${label}에는 정해진 자리표시 외의 중괄호를 쓸 수 없습니다.` })
    return false
  }
  if (options.periodNumberForbidden && hasPeriodNumber(value)) {
    problems.push({ field, message: `${label}에는 숫자나 기간을 직접 적지 말고 자리표시를 써 주세요. 숫자가 필요한 표현은 본문에 두세요.` })
    return false
  }
  return true
}

// 2판 키 검사(4-3 (S)~(f)). 링크 문서가 보이는지((g))는 결제 때만 따로 본다. 문제가 없으면 빈 배열.
export function checkCheckoutConsentKeys(kind: CheckoutConsentKind, value: unknown): CheckoutConsentProblem[] {
  const spec = CHECKOUT_CONSENT_SPECS[kind]
  const problems: CheckoutConsentProblem[] = []
  const record = asRecord(value)
  if (!record) return [{ field: 'consentTitle', message: '정책 값을 읽지 못했습니다.' }]

  // (a) 제목
  if (checkConsentString(kind, 'consentTitle', '동의 제목', record.consentTitle,
    { oneLine: true, min: 1, max: CHECKOUT_CONSENT_TITLE_MAX, periodNumberForbidden: true }, problems)) {
    if ((record.consentTitle as string).includes(CHECKOUT_CONSENT_REQUIRED_MARK)) {
      problems.push({ field: 'consentTitle', message: `동의 제목에는 '${CHECKOUT_CONSENT_REQUIRED_MARK}'를 넣지 마세요. 결제 화면이 붙입니다.` })
    }
  }

  // (b) 요약 줄
  const summary = asRecord(record.consentSummary)
  if (!summary) {
    problems.push({ field: 'consentSummary', message: '요약 줄을 읽지 못했습니다.' })
  } else {
    const roles = spec.summaryRoles.map((role) => role.role)
    for (const key of Object.keys(summary)) {
      if (!roles.includes(key)) problems.push({ field: 'consentSummary', message: `알 수 없는 요약 줄(${key})이 있습니다.` })
    }
    let total = 0
    for (const role of spec.summaryRoles) {
      const field = `consentSummary.${role.role}`
      if (!Object.hasOwn(summary, role.role)) {
        if (role.required) problems.push({ field, message: '꼭 있어야 하는 요약 줄입니다.' })
        continue
      }
      const line = summary[role.role]
      if (!checkConsentString(kind, field, '요약 줄', line,
        { oneLine: true, min: 1, max: CHECKOUT_CONSENT_SUMMARY_LINE_MAX, periodNumberForbidden: true }, problems)) continue
      total += charLength(line as string)
      for (const placeholder of role.placeholders) {
        if (!(line as string).includes(placeholder)) {
          problems.push({ field, message: `이 요약 줄에는 자리표시 ${placeholder}을(를) 넣어 주세요.` })
        }
      }
    }
    if (spec.summaryTotalMax !== null && total > spec.summaryTotalMax) {
      problems.push({ field: 'consentSummary', message: `요약 줄은 모두 합쳐 ${spec.summaryTotalMax}자 이하로 입력해 주세요(지금 ${total}자).` })
    }
  }

  // (d)(e)(f) 항목
  const items = record.consentItems
  if (!Array.isArray(items) || items.length < 1 || items.length > CHECKOUT_CONSENT_ITEMS_MAX) {
    problems.push({ field: 'consentItems', message: `세부 항목은 1~${CHECKOUT_CONSENT_ITEMS_MAX}개여야 합니다.` })
    return problems
  }
  const keys = new Set<string>()
  const usedTargets = new Set<string>()
  const usedLinks = new Set<string>()
  items.forEach((raw, index) => {
    const field = `consentItems.${index}`
    const item = asRecord(raw)
    if (!item) {
      problems.push({ field, message: '세부 항목 모양이 올바르지 않습니다.' })
      return
    }
    const itemKeys = Object.keys(item).sort().join(',')
    const view = item.view
    if (view === 'text' ? itemKeys !== 'key,label,textKeys,view' : view === 'link' ? itemKeys !== 'key,label,link,view' : true) {
      problems.push({ field, message: '세부 항목 모양이 올바르지 않습니다.' })
      return
    }
    if (typeof item.key !== 'string' || !ITEM_KEY_PATTERN.test(item.key) || keys.has(item.key)) {
      problems.push({ field: `${field}.key`, message: '세부 항목 키가 올바르지 않거나 겹칩니다.' })
    } else {
      keys.add(item.key)
    }
    checkConsentString(kind, `${field}.label`, '항목 이름', item.label,
      { oneLine: true, min: 1, max: CHECKOUT_CONSENT_ITEM_LABEL_MAX, periodNumberForbidden: true }, problems)
    if (view === 'text') {
      const textKeys = item.textKeys
      if (!Array.isArray(textKeys) || textKeys.length < 1 || textKeys.length > CHECKOUT_CONSENT_TEXT_KEYS_MAX) {
        problems.push({ field: `${field}.textKeys`, message: `본문 대상은 1~${CHECKOUT_CONSENT_TEXT_KEYS_MAX}개여야 합니다.` })
        return
      }
      for (const target of textKeys) {
        if (typeof target !== 'string' || !spec.textTargets.includes(target)) {
          problems.push({ field: `${field}.textKeys`, message: '가리킬 수 없는 본문입니다.' })
          continue
        }
        if (usedTargets.has(target)) {
          problems.push({ field: `${field}.textKeys`, message: '다른 항목이 이미 가리킨 본문입니다.' })
          continue
        }
        usedTargets.add(target)
      }
    } else {
      const link = item.link
      if (typeof link !== 'string' || !(CHECKOUT_CONSENT_LINK_KEYS as readonly string[]).includes(link) || usedLinks.has(link)) {
        problems.push({ field: `${field}.link`, message: '링크 대상이 올바르지 않거나 겹칩니다.' })
      } else {
        usedLinks.add(link)
      }
    }
  })
  for (const target of spec.requiredTargets) {
    if (!usedTargets.has(target)) problems.push({ field: 'consentItems', message: `꼭 넣어야 하는 본문(${target})이 빠졌습니다.` })
  }
  for (const link of CHECKOUT_CONSENT_LINK_KEYS) {
    if (!usedLinks.has(link)) problems.push({ field: 'consentItems', message: `꼭 넣어야 하는 링크(${link})가 빠졌습니다.` })
  }
  // 가리킨 본문(S): 글자·중괄호·비지 않음(LF 는 허용)
  for (const target of usedTargets) {
    const body = readCheckoutConsentTarget(kind, record, target)
    if (typeof body !== 'string' || !isNotBlank(body)) {
      problems.push({ field: `body:${target}`, message: '항목이 가리킨 본문이 비어 있습니다.' })
    } else if (hasStrayBraces(kind, body)) {
      problems.push({ field: `body:${target}`, message: '항목이 가리킨 본문에 정해진 자리표시 외의 중괄호가 있습니다.' })
    }
  }
  return problems
}

// 2판 묶음 만들기(지문 빼고). 검사에 걸리면 null. 판은 보지 않는다(판 1 일 때도 미리보기·스크립트·단계 6 이 부른다).
export function buildCheckoutConsentDraft(kind: CheckoutConsentKind, value: unknown, refundDays: number): CheckoutConsentBundleDraft | null {
  if (!Number.isInteger(refundDays) || refundDays <= 0) return null
  if (checkCheckoutConsentKeys(kind, value).length > 0) return null
  const record = value as Record<string, unknown>
  const fill = (text: string) => fillCheckoutConsentText(kind, text, refundDays)
  const summary = record.consentSummary as Record<string, string>
  const consentSummary = CHECKOUT_CONSENT_SPECS[kind].summaryRoles
    .filter((role) => Object.hasOwn(summary, role.role))
    .map((role) => fill(summary[role.role]))
  const consentItems = (record.consentItems as CheckoutConsentRawItem[]).map((item): CheckoutConsentItem => (
    item.view === 'text'
      ? { key: item.key, label: fill(item.label), view: 'text', texts: item.textKeys.map((target) => fill(readCheckoutConsentTarget(kind, record, target) as string)) }
      : { key: item.key, label: fill(item.label), view: 'link', link: item.link }
  ))
  return { consentFormat: 2, consentTitle: fill(record.consentTitle as string), consentSummary, consentItems, refundDays }
}

// 원문(5-1): 줄을 LF 로 잇는다(끝 LF 없음, trim·정규화 없음). 묶음에서 다시 만든 원문의 sha256 = noticeSha256.
export function buildCheckoutConsentText(bundle: Pick<CheckoutConsentBundle, 'consentTitle' | 'consentSummary' | 'consentItems'>): string {
  const lines = [bundle.consentTitle, ...bundle.consentSummary]
  for (const item of bundle.consentItems) {
    lines.push(item.label)
    if (item.view === 'text') lines.push(...item.texts)
    else lines.push(`${CHECKOUT_CONSENT_LINK_PREFIX}${item.link}`)
  }
  return lines.join('\n')
}

// 바깥(뷰·409·DB 응답)에서 받은 2판 묶음 해석. 모양이 틀리면 null(결제 닫힘). plan 같은 다른 키는 버린다.
export function parseCheckoutConsentBundle(input: unknown): CheckoutConsentBundle | null {
  const value = asRecord(input)
  if (!value || value.consentFormat !== 2) return null
  if (typeof value.consentTitle !== 'string' || !isNotBlank(value.consentTitle)) return null
  if (typeof value.noticeSha256 !== 'string' || !SHA256_PATTERN.test(value.noticeSha256)) return null
  if (typeof value.refundDays !== 'number' || !Number.isInteger(value.refundDays) || value.refundDays <= 0) return null
  if (!Array.isArray(value.consentSummary) || value.consentSummary.length < 1
    || !value.consentSummary.every((line) => typeof line === 'string' && isNotBlank(line))) return null
  if (!Array.isArray(value.consentItems) || value.consentItems.length < 1 || value.consentItems.length > CHECKOUT_CONSENT_ITEMS_MAX) return null
  const items: CheckoutConsentItem[] = []
  for (const raw of value.consentItems) {
    const item = asRecord(raw)
    if (!item || typeof item.key !== 'string' || typeof item.label !== 'string' || !isNotBlank(item.label)) return null
    if (item.view === 'text') {
      if (!Array.isArray(item.texts) || item.texts.length < 1 || !item.texts.every((text) => typeof text === 'string')) return null
      items.push({ key: item.key, label: item.label, view: 'text', texts: item.texts as string[] })
    } else if (item.view === 'link') {
      if (typeof item.link !== 'string' || !(CHECKOUT_CONSENT_LINK_KEYS as readonly string[]).includes(item.link)) return null
      items.push({ key: item.key, label: item.label, view: 'link', link: item.link as CheckoutConsentLinkKey })
    } else {
      return null
    }
  }
  return {
    consentFormat: 2,
    consentTitle: value.consentTitle,
    consentSummary: value.consentSummary as string[],
    consentItems: items,
    noticeSha256: value.noticeSha256,
    refundDays: value.refundDays,
  }
}

// 동의 사본 구조(6-4): 요약 줄 수, 항목 수, 항목마다 key·view·texts 수. 지문이 같아도 구조가 다르면 동의를 비운다.
export function checkoutConsentStructureKey(bundle: Pick<CheckoutConsentBundle, 'consentSummary' | 'consentItems'>): string {
  return JSON.stringify([
    bundle.consentSummary.length,
    bundle.consentItems.map((item) => [item.key, item.view, item.view === 'text' ? item.texts.length : 0]),
  ])
}

// 4-3 (g): 링크 문서가 보이는지 — 정규화하지 않은 바닥글 원본(value.policyDocuments.<키>)에서 본다.
// 객체, enabled 가 정확히 true, label·content 가 비지 않은 글자. (inspectRawFooterPolicyDocument 의 'enabled 없으면 켜짐'보다 엄격하다.)
export function isRawFooterPolicyDocumentVisible(rawFooterValue: unknown, link: CheckoutConsentLinkKey): boolean {
  const documents = asRecord(asRecord(rawFooterValue)?.policyDocuments)
  const document = asRecord(documents?.[link])
  if (!document || document.enabled !== true) return false
  return typeof document.label === 'string' && isNotBlank(document.label)
    && typeof document.content === 'string' && isNotBlank(document.content)
}

export function areCheckoutConsentLinksVisible(rawFooterValue: unknown): boolean {
  return CHECKOUT_CONSENT_LINK_KEYS.every((link) => isRawFooterPolicyDocumentVisible(rawFooterValue, link))
}

// 장바구니 문구 검사(4-3 끝): 글자, 중괄호 없음, LF 없음, 비지 않음, 1~300자. 어기면 결제 칸을 닫는다(1판·2판 모두).
export const MARKET_CART_TEXT_LABELS: Record<MarketCartTextKey, string> = {
  cartCheckoutNotice: '장바구니 결제 안내(전체 취소)',
  partialOwnedConfirmLabel: '부분 보유 전체 패키지 정가 확인',
}

export function checkMarketCartTexts(value: unknown): CheckoutConsentProblem[] {
  const record = asRecord(value)
  const problems: CheckoutConsentProblem[] = []
  for (const key of MARKET_CART_TEXT_KEYS) {
    const label = MARKET_CART_TEXT_LABELS[key]
    const text = record?.[key]
    if (typeof text !== 'string' || !isNotBlank(text)) {
      problems.push({ field: key, message: `${label}을(를) 입력해 주세요.` })
    } else if (charLength(text) > MARKET_CART_TEXT_MAX) {
      problems.push({ field: key, message: `${label}은(는) ${MARKET_CART_TEXT_MAX}자 이하로 입력해 주세요.` })
    } else if (text.includes('\n')) {
      problems.push({ field: key, message: `${label}은(는) 한 줄로 입력해 주세요(줄바꿈 없음).` })
    } else if (/[{}]/.test(text)) {
      problems.push({ field: key, message: `${label}에는 중괄호를 쓸 수 없습니다.` })
    }
  }
  return problems
}

// 장바구니 문구 지문 원문 = 안내 + LF + 정가 확인(trim 없음). 지문은 서버(DB 와 같은 값)만 계산하고 화면은 받은 값을 그대로 보낸다.
export function buildMarketCartTextsSource(texts: Pick<MarketCartTexts, MarketCartTextKey>): string {
  return `${texts.cartCheckoutNotice}\n${texts.partialOwnedConfirmLabel}`
}

export function parseMarketCartTexts(input: unknown): MarketCartTexts | null {
  const value = asRecord(input)
  if (!value) return null
  if (checkMarketCartTexts(value).length > 0) return null
  if (typeof value.cartTextsSha256 !== 'string' || !SHA256_PATTERN.test(value.cartTextsSha256)) return null
  return {
    cartCheckoutNotice: value.cartCheckoutNotice as string,
    partialOwnedConfirmLabel: value.partialOwnedConfirmLabel as string,
    cartTextsSha256: value.cartTextsSha256,
  }
}

// 장바구니 잔액 부족 충전 안내(대표 요청·결정 2026-11-26): 안내 줄과 두 버튼 이름. 동의·지문과 관계없는 안내라 장바구니 문구 지문(cartTexts)에는 넣지 않는다.
// 안내 줄의 자리표시 {부족크레딧} 은 화면이 부족한 크레딧 수(천 단위 쉼표)로 채운다. 세 키가 모두 규칙을 지킬 때만 화면이 쓴다(아니면 충전 버튼 없이 결제만 막음).
export const MARKET_CART_INSUFFICIENT_KEYS = ['cartInsufficientNotice', 'cartChargeButtonLabel', 'cartBalanceRecheckLabel'] as const
export type MarketCartInsufficientKey = (typeof MARKET_CART_INSUFFICIENT_KEYS)[number]
export const MARKET_CART_INSUFFICIENT_NOTICE_KEY: MarketCartInsufficientKey = 'cartInsufficientNotice'
export const MARKET_SHORTFALL_PLACEHOLDER = '{부족크레딧}'
export const MARKET_CART_INSUFFICIENT_LABELS: Record<MarketCartInsufficientKey, string> = {
  cartInsufficientNotice: '잔액 부족 충전 안내',
  cartChargeButtonLabel: '잔액 부족 때 충전 버튼 이름',
  cartBalanceRecheckLabel: '잔액 부족 때 잔액 다시 확인 버튼 이름',
}
export const MARKET_CART_INSUFFICIENT_MAX: Record<MarketCartInsufficientKey, number> = {
  cartInsufficientNotice: 200,
  cartChargeButtonLabel: 20,
  cartBalanceRecheckLabel: 20,
}

export interface MarketCartInsufficientTexts {
  // 채우기 전 안내 틀
  notice: string
  chargeLabel: string
  recheckLabel: string
}

// 저장·화면 검사: 글자, 비지 않음, 최대 글자, 한 줄, 중괄호 없음(안내 줄은 {부족크레딧} 만). keys 를 주면 그 키만 본다.
export function checkMarketCartInsufficientTexts(value: unknown, keys: readonly MarketCartInsufficientKey[] = MARKET_CART_INSUFFICIENT_KEYS): CheckoutConsentProblem[] {
  const record = asRecord(value)
  const problems: CheckoutConsentProblem[] = []
  for (const field of keys) {
    const label = MARKET_CART_INSUFFICIENT_LABELS[field]
    const max = MARKET_CART_INSUFFICIENT_MAX[field]
    const text = record?.[field]
    const placeholder = field === 'cartInsufficientNotice' ? MARKET_SHORTFALL_PLACEHOLDER : null
    if (typeof text !== 'string' || !isNotBlank(text)) problems.push({ field, message: `${label}을(를) 입력해 주세요.` })
    else if (charLength(text) > max) problems.push({ field, message: `${label}은(는) ${max}자 이하로 입력해 주세요.` })
    else if (text.includes('\n')) problems.push({ field, message: `${label}은(는) 한 줄로 입력해 주세요(줄바꿈 없음).` })
    else if (/[{}]/.test(placeholder ? text.split(placeholder).join('') : text)) {
      problems.push({ field, message: placeholder ? `${label}에는 ${placeholder} 외의 중괄호를 쓸 수 없습니다.` : `${label}에는 중괄호를 쓸 수 없습니다.` })
    }
  }
  return problems
}

// 저장된 원본에서 세 키를 읽는다. 하나라도 없거나 규칙을 어기면 null.
export function readMarketCartInsufficientTexts(value: unknown): MarketCartInsufficientTexts | null {
  if (checkMarketCartInsufficientTexts(value).length > 0) return null
  const record = asRecord(value)!
  return {
    notice: record.cartInsufficientNotice as string,
    chargeLabel: record.cartChargeButtonLabel as string,
    recheckLabel: record.cartBalanceRecheckLabel as string,
  }
}

export function fillMarketShortfall(template: string, shortfall: number): string {
  return template.split(MARKET_SHORTFALL_PLACEHOLDER).join(Math.max(shortfall, 0).toLocaleString('ko-KR'))
}
