// 16번 묶음 6절: 회원 알림 규칙(순수). 글·켜기·분류 이름·상한 숫자는 DB(system_settings 'member_notification_texts')에만 있고,
// 여기에는 종류·허용/필수 자리표시·끌 수 없는 종류·링크·type 같은 규칙만 둔다(코드에 기본 문구 없음 — 문구가 없으면 보내지 않는다).
// 구조 검사는 DB public.member_notification_texts_problem 과 같은 규칙이다(계약 시험이 두 목록을 대조한다).

export const MEMBER_NOTIFICATION_TEXTS_SETTING_KEY = 'member_notification_texts'
export const MEMBER_NOTIFICATION_TEXTS_CACHE_TAG = 'member_notification_texts'
export const MEMBER_NOTIFICATION_TEXTS_CACHE_SECONDS = 60

// 종류 키(DB member_notification_texts_problem 의 v_kinds 와 같은 목록·순서)
export const MEMBER_NOTIFICATION_KIND_KEYS = [
  'chargeCompleted',
  'chargeRefundCompleted',
  'chargeRefundBankTransfer',
  'chargeRefundProviderFinalized',
  'supportAnswerCreated',
  'supportAnswerEdited',
  'creditGranted',
  'creditRevoked',
  'marketRefundApproved',
  'marketRefundException',
  'marketRefundRejected',
  'chargeRefundRejected',
] as const

export type MemberNotificationKind = (typeof MEMBER_NOTIFICATION_KIND_KEYS)[number]

export const MEMBER_NOTIFICATION_PLACEHOLDERS = ['{금액}', '{문의제목}', '{분류}', '{수량}', '{내용}', '{사유}'] as const
export type MemberNotificationPlaceholder = (typeof MEMBER_NOTIFICATION_PLACEHOLDERS)[number]

export interface MemberNotificationKindSpec {
  // 관리자 화면 이름·설명(관리자 글)
  label: string
  when: string
  screen: string
  // notifications.type(벨·목록 모양은 바꾸지 않는다 — 지금 운영 값 그대로)
  type: 'success' | 'info' | 'inquiry_reply'
  link: string
  // 제목·내용에 쓸 수 있는 자리표시와 내용에 꼭 있어야 하는 자리표시
  placeholders: readonly MemberNotificationPlaceholder[]
  required: readonly MemberNotificationPlaceholder[]
  // 끌 수 있는지(Q2: 회원에게 불리한 결과를 알리는 셋은 끌 수 없고 {사유}도 뺄 수 없다)
  canDisable: boolean
  // 내용 없이 제목만(내용은 마켓 환불 문장 4개로 만든다)
  titleOnly?: boolean
}

export const MEMBER_NOTIFICATION_KINDS: Record<MemberNotificationKind, MemberNotificationKindSpec> = {
  chargeCompleted: {
    label: '충전 완료', when: '결제가 확인되어 크레딧이 충전되었을 때(결제 통보·대사 재지급·관리자 결제 확인)', screen: '크레딧 관리',
    type: 'success', link: '/mypage/credits', placeholders: [], required: [], canDisable: true,
  },
  chargeRefundCompleted: {
    label: '충전 환불 완료(원 결제수단)', when: '관리자가 원 결제수단 환불·결제사 관리자 취소로 환불을 끝냈을 때', screen: '결제 내역',
    type: 'success', link: '/mypage/payments', placeholders: ['{금액}'], required: [], canDisable: true,
  },
  chargeRefundBankTransfer: {
    label: '충전 환불 완료(계좌)', when: '관리자가 계좌 송금으로 환불을 끝냈을 때', screen: '결제 내역',
    type: 'success', link: '/mypage/payments', placeholders: ['{금액}'], required: [], canDisable: true,
  },
  chargeRefundProviderFinalized: {
    label: '결제사 취소 확인 환불', when: '결제사 취소 통보·대사로 환불이 끝났을 때', screen: '결제 내역',
    type: 'success', link: '/mypage/payments', placeholders: [], required: [], canDisable: true,
  },
  supportAnswerCreated: {
    label: '문의 답변', when: '1:1 문의에 첫 답변을 저장했을 때', screen: '고객지원',
    type: 'inquiry_reply', link: '/mypage/support', placeholders: ['{문의제목}'], required: [], canDisable: true,
  },
  supportAnswerEdited: {
    label: '문의 답변 수정', when: '저장한 답변을 고쳤을 때', screen: '고객지원',
    type: 'inquiry_reply', link: '/mypage/support', placeholders: ['{문의제목}'], required: [], canDisable: true,
  },
  creditGranted: {
    label: '크레딧 지급', when: '관리자가 크레딧을 지급했을 때', screen: '크레딧 관리',
    type: 'info', link: '/mypage/credits', placeholders: ['{분류}', '{수량}', '{내용}'], required: [], canDisable: true,
  },
  creditRevoked: {
    label: '크레딧 회수', when: '잘못 지급한 크레딧을 회수했을 때', screen: '크레딧 관리',
    type: 'info', link: '/mypage/credits', placeholders: ['{수량}', '{사유}'], required: ['{사유}'], canDisable: false,
  },
  marketRefundApproved: {
    label: '마켓 환불 승인', when: '문제마켓 환불 요청을 승인·대표 정산했을 때', screen: '크레딧 관리',
    type: 'success', link: '/mypage/credits', placeholders: [], required: [], canDisable: true, titleOnly: true,
  },
  marketRefundException: {
    label: '마켓 예외 환불', when: '관리자가 주문에서 예외 환불을 처리했을 때', screen: '크레딧 관리',
    type: 'success', link: '/mypage/credits', placeholders: [], required: [], canDisable: true, titleOnly: true,
  },
  marketRefundRejected: {
    label: '마켓 환불 거절', when: '문제마켓 환불 요청을 거절했을 때', screen: '고객지원',
    type: 'info', link: '/mypage/support', placeholders: ['{사유}'], required: ['{사유}'], canDisable: false,
  },
  chargeRefundRejected: {
    label: '충전 환불 거절', when: '충전 환불 요청을 거절했을 때', screen: '결제 내역',
    type: 'info', link: '/mypage/payments', placeholders: ['{사유}'], required: ['{사유}'], canDisable: false,
  },
}

// 크레딧 지급 분류(지급 route 의 category 값) — 이름은 DB categoryLabels
export const CREDIT_GRANT_CATEGORY_KEYS = ['compensation', 'event', 'refund', 'other'] as const
export type CreditGrantCategoryKey = (typeof CREDIT_GRANT_CATEGORY_KEYS)[number]
// 마켓 환불 내용 문장 4개(옛 buildMarketRefundApprovedMessage 의 조립 규칙 그대로, 문장만 DB). {수량}만 쓸 수 있다(unknown 은 자리표시 없음).
export const MARKET_REFUND_MESSAGE_KEYS = ['base', 'reissued', 'missing', 'unknown'] as const
export type MarketRefundMessageKey = (typeof MARKET_REFUND_MESSAGE_KEYS)[number]
export const BROADCAST_SETTING_KEYS = ['memberLabel', 'allMembersDailyLimit', 'selfTestDailyLimit', 'notAdvertisingStatement',
  'notAdvertisingStatementVersion', 'redactedText'] as const

// 길이(DB 함수와 같은 값)
export const MEMBER_NOTIFICATION_TITLE_MAX = 100
export const MEMBER_NOTIFICATION_MESSAGE_MAX = 500
export const CREDIT_GRANT_CATEGORY_LABEL_MAX = 20
export const MARKET_REFUND_MESSAGE_MAX = 300
export const BROADCAST_MEMBER_LABEL_MAX = 10
export const BROADCAST_STATEMENT_MAX = 500
export const BROADCAST_REDACTED_TEXT_MAX = 60
export const BROADCAST_ALL_MEMBERS_LIMIT_RANGE = [1, 5] as const
export const BROADCAST_SELF_TEST_LIMIT_RANGE = [1, 50] as const

export interface MemberNotificationKindTexts {
  enabled: boolean
  title: string
  message?: string
  categoryLabels?: Record<CreditGrantCategoryKey, string>
}

export interface MemberBroadcastSettings {
  memberLabel: string
  allMembersDailyLimit: number
  selfTestDailyLimit: number
  notAdvertisingStatement: string
  notAdvertisingStatementVersion: number
  redactedText: string
}

export interface MemberNotificationTexts {
  revision: number
  kinds: Record<MemberNotificationKind, MemberNotificationKindTexts>
  marketRefundMessage: Record<MarketRefundMessageKey, string>
  broadcast: MemberBroadcastSettings
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const sameKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
const charLength = (text: string) => [...text].length
const oneLine = (text: unknown, max: number): text is string =>
  typeof text === 'string' && text.trim() !== '' && charLength(text) <= max && !/[\r\n]/.test(text)
const isIntIn = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

// 구조 검사(DB member_notification_texts_problem 과 같은 순서·경로). 문제가 없으면 null.
export function memberNotificationTextsProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'value'
  if (!sameKeys(value, ['broadcast', 'kinds', 'marketRefundMessage', 'revision'])) return 'keys'
  if (!isIntIn(value.revision, 1, 999_999_999)) return 'revision'
  const kinds = value.kinds
  if (!isRecord(kinds) || !sameKeys(kinds, MEMBER_NOTIFICATION_KIND_KEYS)) return 'kinds'
  for (const kind of MEMBER_NOTIFICATION_KIND_KEYS) {
    const spec = MEMBER_NOTIFICATION_KINDS[kind]
    const item = kinds[kind]
    const expected = spec.titleOnly ? ['enabled', 'title'] : kind === 'creditGranted' ? ['categoryLabels', 'enabled', 'message', 'title'] : ['enabled', 'message', 'title']
    if (!isRecord(item) || !sameKeys(item, expected)) return `kinds.${kind}`
    if (typeof item.enabled !== 'boolean' || (!spec.canDisable && item.enabled !== true)) return `kinds.${kind}.enabled`
    if (!oneLine(item.title, MEMBER_NOTIFICATION_TITLE_MAX)) return `kinds.${kind}.title`
    if (!spec.titleOnly) {
      const message = item.message
      if (typeof message !== 'string' || message.trim() === '' || charLength(message) > MEMBER_NOTIFICATION_MESSAGE_MAX
        || spec.required.some((token) => !message.includes(token))) return `kinds.${kind}.message`
    }
  }
  const labels = (kinds.creditGranted as Record<string, unknown>).categoryLabels
  if (!isRecord(labels) || !sameKeys(labels, CREDIT_GRANT_CATEGORY_KEYS)) return 'kinds.creditGranted.categoryLabels'
  for (const key of CREDIT_GRANT_CATEGORY_KEYS) {
    if (!oneLine(labels[key], CREDIT_GRANT_CATEGORY_LABEL_MAX)) return `kinds.creditGranted.categoryLabels.${key}`
  }
  const market = value.marketRefundMessage
  if (!isRecord(market) || !sameKeys(market, MARKET_REFUND_MESSAGE_KEYS)) return 'marketRefundMessage'
  for (const key of MARKET_REFUND_MESSAGE_KEYS) {
    if (!oneLine(market[key], MARKET_REFUND_MESSAGE_MAX)) return `marketRefundMessage.${key}`
  }
  const broadcast = value.broadcast
  if (!isRecord(broadcast) || !sameKeys(broadcast, BROADCAST_SETTING_KEYS)) return 'broadcast'
  if (!oneLine(broadcast.memberLabel, BROADCAST_MEMBER_LABEL_MAX)) return 'broadcast.memberLabel'
  if (!isIntIn(broadcast.allMembersDailyLimit, ...BROADCAST_ALL_MEMBERS_LIMIT_RANGE)) return 'broadcast.allMembersDailyLimit'
  if (!isIntIn(broadcast.selfTestDailyLimit, ...BROADCAST_SELF_TEST_LIMIT_RANGE)) return 'broadcast.selfTestDailyLimit'
  const statement = broadcast.notAdvertisingStatement
  if (typeof statement !== 'string' || statement.trim() === '' || charLength(statement) > BROADCAST_STATEMENT_MAX) return 'broadcast.notAdvertisingStatement'
  if (!isIntIn(broadcast.notAdvertisingStatementVersion, 1, 999_999_999)) return 'broadcast.notAdvertisingStatementVersion'
  if (!oneLine(broadcast.redactedText, BROADCAST_REDACTED_TEXT_MAX)) return 'broadcast.redactedText'
  return null
}

// 읽을 때 검사: 구조가 깨졌으면 null(보내지 않음 — 'texts_unavailable').
export function parseMemberNotificationTexts(raw: unknown): MemberNotificationTexts | null {
  return memberNotificationTextsProblem(raw) === null ? (raw as MemberNotificationTexts) : null
}

const TOKEN_PATTERN = /\{[^{}]*\}/g

function tokensOf(text: string) {
  return [...text.matchAll(TOKEN_PATTERN)].map((match) => match[0])
}

// 저장 전 검사(서버 액션·화면): 구조 + 허용 자리표시. 허용 밖 자리표시는 DB 함수가 보지 않으므로 여기서 막는다.
export function validateMemberNotificationTextsInput(value: unknown): string | null {
  const problem = memberNotificationTextsProblem(value)
  if (problem) return problem
  const texts = value as MemberNotificationTexts
  for (const kind of MEMBER_NOTIFICATION_KIND_KEYS) {
    const spec = MEMBER_NOTIFICATION_KINDS[kind]
    const item = texts.kinds[kind]
    const allowed: readonly string[] = spec.placeholders
    if (tokensOf(item.title).some((token) => !allowed.includes(token))) return `kinds.${kind}.title`
    if (item.message !== undefined && tokensOf(item.message).some((token) => !allowed.includes(token))) return `kinds.${kind}.message`
  }
  for (const key of CREDIT_GRANT_CATEGORY_KEYS) {
    if (tokensOf(texts.kinds.creditGranted.categoryLabels?.[key] ?? '').length > 0) return `kinds.creditGranted.categoryLabels.${key}`
  }
  for (const key of MARKET_REFUND_MESSAGE_KEYS) {
    const allowed = key === 'unknown' ? [] : ['{수량}']
    if (tokensOf(texts.marketRefundMessage[key]).some((token) => !allowed.includes(token))) return `marketRefundMessage.${key}`
  }
  for (const key of ['memberLabel', 'notAdvertisingStatement', 'redactedText'] as const) {
    if (tokensOf(texts.broadcast[key]).length > 0) return `broadcast.${key}`
  }
  return null
}

// 저장할 때 다듬기(앞뒤 공백, 줄바꿈 통일). 판·경계 판은 DB 함수가 정한다.
export function normalizeMemberNotificationTexts(texts: MemberNotificationTexts): MemberNotificationTexts {
  const clean = (text: string) => text.replace(/\r\n?/g, '\n').trim()
  const kinds = {} as MemberNotificationTexts['kinds']
  for (const kind of MEMBER_NOTIFICATION_KIND_KEYS) {
    const item = texts.kinds[kind]
    kinds[kind] = {
      enabled: item.enabled,
      title: clean(item.title),
      ...(item.message !== undefined ? { message: clean(item.message) } : {}),
      ...(item.categoryLabels ? { categoryLabels: Object.fromEntries(CREDIT_GRANT_CATEGORY_KEYS.map((key) => [key, clean(item.categoryLabels?.[key] ?? '')])) as Record<CreditGrantCategoryKey, string> } : {}),
    }
  }
  return {
    revision: texts.revision,
    kinds,
    marketRefundMessage: Object.fromEntries(MARKET_REFUND_MESSAGE_KEYS.map((key) => [key, clean(texts.marketRefundMessage[key])])) as MemberNotificationTexts['marketRefundMessage'],
    broadcast: {
      memberLabel: clean(texts.broadcast.memberLabel),
      allMembersDailyLimit: texts.broadcast.allMembersDailyLimit,
      selfTestDailyLimit: texts.broadcast.selfTestDailyLimit,
      notAdvertisingStatement: clean(texts.broadcast.notAdvertisingStatement),
      notAdvertisingStatementVersion: texts.broadcast.notAdvertisingStatementVersion,
      redactedText: clean(texts.broadcast.redactedText),
    },
  }
}

export function isMemberNotificationEnabled(kind: MemberNotificationKind, texts: MemberNotificationTexts) {
  // 끌 수 없는 종류는 enabled: false 를 무시한다(쓰기 막기·저장 함수에 이은 세 번째 겹)
  return !MEMBER_NOTIFICATION_KINDS[kind].canDisable || texts.kinds[kind].enabled
}

export type MemberNotificationValues = Partial<Record<MemberNotificationPlaceholder, string | number>>

const formatValue = (value: string | number) => (typeof value === 'number' ? value.toLocaleString('ko-KR') : value)

// 자리표시 채우기: 한 번에 바꾼다(값 속 {…}는 다시 풀리지 않음). 허용 밖 자리표시나 값이 없는(빈) 자리표시가 있으면 null.
export function fillMemberNotificationTemplate(template: string, allowed: readonly string[], values: MemberNotificationValues): string | null {
  let failed = false
  const filled = template.replace(TOKEN_PATTERN, (token) => {
    const value = values[token as MemberNotificationPlaceholder]
    if (!allowed.includes(token) || value === undefined || value === null || String(value).trim() === '') {
      failed = true
      return token
    }
    return formatValue(value)
  })
  return failed ? null : filled
}

export interface MarketRefundMessageInput {
  requested_refund_credits?: number | null
  approved_refund_credits?: number | null
  allocated_items?: unknown
}

// 마켓 환불 승인·대표 정산·예외 환불 공용 내용. 다시 지급한 몫과 돌려주지 못한 몫을 따로 알린다(정책 3-2 ⑥⑦, 옛 조립 규칙 그대로).
export function buildMarketRefundMessage(request: MarketRefundMessageInput, texts: MemberNotificationTexts['marketRefundMessage']): string | null {
  if (typeof request.approved_refund_credits !== 'number') return fillMemberNotificationTemplate(texts.unknown, [], {})
  const items = Array.isArray(request.allocated_items) ? (request.allocated_items as Array<{ reissued?: number }>) : []
  const reissued = items.reduce((sum, item) => sum + (Number(item.reissued) || 0), 0)
  const missing = typeof request.requested_refund_credits === 'number'
    ? Math.max(request.requested_refund_credits - request.approved_refund_credits, 0)
    : 0
  const parts = [
    fillMemberNotificationTemplate(texts.base, ['{수량}'], { '{수량}': request.approved_refund_credits }),
    reissued > 0 ? fillMemberNotificationTemplate(texts.reissued, ['{수량}'], { '{수량}': reissued }) : '',
    missing > 0 ? fillMemberNotificationTemplate(texts.missing, ['{수량}'], { '{수량}': missing }) : '',
  ]
  if (parts.some((part) => part === null)) return null
  return parts.filter(Boolean).join(' ')
}

export interface MemberNotificationRenderInput {
  values?: MemberNotificationValues
  // creditGranted: 지급 분류(이름은 DB categoryLabels, 모르는 값은 other)
  categoryKey?: string
  // marketRefundApproved·marketRefundException: 환불 요청 행
  marketRefund?: MarketRefundMessageInput
}

export interface RenderedMemberNotification {
  type: MemberNotificationKindSpec['type']
  title: string
  message: string
  link: string
}

// 한 종류를 그린다. 허용 밖·필수 빠짐·값 없음·제목 줄바꿈이면 null(보내지 않고 관리자 화면에 실패로 알림). 켜짐 여부는 보지 않는다.
export function renderMemberNotification(kind: MemberNotificationKind, texts: MemberNotificationTexts, input: MemberNotificationRenderInput = {}): RenderedMemberNotification | null {
  const spec = MEMBER_NOTIFICATION_KINDS[kind]
  const item = texts.kinds[kind]
  if (!item) return null
  const values: MemberNotificationValues = { ...(input.values ?? {}) }
  if (kind === 'creditGranted') {
    const labels = item.categoryLabels
    if (!labels) return null
    const key = (CREDIT_GRANT_CATEGORY_KEYS as readonly string[]).includes(input.categoryKey ?? '') ? input.categoryKey as CreditGrantCategoryKey : 'other'
    values['{분류}'] = labels[key]
  }
  const title = fillMemberNotificationTemplate(item.title, spec.placeholders, values)
  if (title === null || /[\r\n]/.test(title) || title.trim() === '') return null
  let message: string | null
  if (spec.titleOnly) {
    message = input.marketRefund ? buildMarketRefundMessage(input.marketRefund, texts.marketRefundMessage) : null
  } else {
    const template = item.message ?? ''
    if (spec.required.some((token) => !template.includes(token))) return null
    message = fillMemberNotificationTemplate(template, spec.placeholders, values)
  }
  if (message === null || message.trim() === '') return null
  return { type: spec.type, title, message, link: spec.link }
}

// ── 관리자 화면 실패 알림(6절 표: 경로마다 같은 칸 notificationFailed) ─────────────────────────────────────────
export const MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE = '회원 알림을 보내지 못했습니다. 고객지원으로 직접 알려 주세요.'

// 긴 숫자(계좌·카드번호 등) — DB public.member_text_has_long_number 와 같은 규칙(숫자·공백·하이픈 덩어리에서 숫자가 10개 이상)
export function memberTextHasLongNumber(text: string | null | undefined): boolean {
  if (!text) return false
  return [...text.matchAll(/[0-9][0-9\s-]*/g)].some((match) => match[0].replace(/[^0-9]/g, '').length >= 10)
}

// 충전 환불 거절: 회원에게 보낼 사유(1~300자)
export const CHARGE_REFUND_REJECT_REASON_MAX = 300

// ── 공지 알림(5-3·5-4·7-3) ───────────────────────────────────────────────────────────────────────────
export const BROADCAST_TITLE_MAX = 60
export const BROADCAST_MESSAGE_MAX = 500
export const BROADCAST_TARGETS = ['all_members', 'self'] as const
export type BroadcastTarget = (typeof BROADCAST_TARGETS)[number]
export const BROADCAST_RETRACT_REASON_CODES = ['mistake', 'pii', 'wrong_target', 'other'] as const
export type BroadcastRetractReasonCode = (typeof BROADCAST_RETRACT_REASON_CODES)[number]
export const BROADCAST_RETRACT_REASON_LABELS: Record<BroadcastRetractReasonCode, string> = {
  mistake: '잘못 보냄',
  pii: '개인정보가 들어감(가림도 함께)',
  wrong_target: '대상이 틀림',
  other: '그 밖의 이유',
}
export const BROADCAST_TARGET_LABELS: Record<BroadcastTarget, string> = { all_members: '가입을 마친 회원 전체', self: '나에게만 시험' }
export const BROADCAST_NOTIFICATION_TYPE = 'announcement'

// 링크 허용 꼴(DB send_member_broadcast 와 같은 목록): 고정 경로, 공지 글(uuid), FAQ 글(#uuid), 하단 정보에 켜진 약관 문서 slug.
// 쿼리·그 밖의 # 는 받지 않는다(링크에 이름 같은 글이 들어갈 수 없게). 판매·충전 화면은 목록에 없다(Q5).
export const BROADCAST_FIXED_LINKS = ['/notices', '/faq', '/terms', '/terms/upcoming'] as const
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const NOTICE_LINK_PATTERN = new RegExp(`^/notices/(${UUID})$`)
const FAQ_LINK_PATTERN = new RegExp(`^/faq#${UUID}$`)
const TERMS_LINK_PATTERN = /^\/terms\/([a-z0-9][a-z0-9-]{0,49})$/

// 링크(없으면 null)와 공지 글 id(있으면 링크 = /notices/{id})가 허용 꼴인지. 게시 중인 공지인지는 DB 함수가 다시 본다.
export function isAllowedBroadcastLink(linkUrl: string | null, postId: string | null, termsSlugs: readonly string[]): boolean {
  if (postId !== null && linkUrl !== `/notices/${postId}`) return false
  if (linkUrl === null) return true
  if ((BROADCAST_FIXED_LINKS as readonly string[]).includes(linkUrl)) return true
  const notice = linkUrl.match(NOTICE_LINK_PATTERN)
  if (notice) return postId === notice[1]
  if (FAQ_LINK_PATTERN.test(linkUrl)) return true
  const terms = linkUrl.match(TERMS_LINK_PATTERN)
  return Boolean(terms && termsSlugs.includes(terms[1]))
}

// 같은 요청 두 번을 한 번으로(재요청) 가리는 지문의 재료 — 화면이 미리보기에서 바뀌었는지 보는 데도 쓴다.
export function broadcastDraftKey(draft: { target: BroadcastTarget; title: string; message: string; linkUrl: string | null; postId: string | null }) {
  return JSON.stringify([draft.target, draft.title.trim(), draft.message.trim(), draft.linkUrl, draft.postId])
}

// DB 함수 오류(코드:세부) → 관리자 화면 문구(관리자 글)
export const MEMBER_NOTIFICATION_ERROR_MESSAGES = {
  MEMBER_NOTIFICATION_ACTOR_NOT_OWNER: '대표 계정만 알림 문구를 고칠 수 있습니다.',
  MEMBER_NOTIFICATION_TEXTS_MISSING: '알림 문구 설정이 없습니다. 개발 담당에게 알려 주세요.',
  MEMBER_NOTIFICATION_REVISION_CONFLICT: '그사이 다른 곳에서 문구가 바뀌었습니다. 다시 불러온 뒤 고쳐 주세요.',
  MEMBER_NOTIFICATION_INPUT_INVALID: '문구 값이 올바르지 않습니다.',
  MEMBER_NOTIFICATION_PII_SUSPECTED: '문구에 개인정보로 보이는 글이 있습니다.',
  BROADCAST_ACTOR_NOT_OWNER: '대표 계정만 공지 알림을 보내거나 회수할 수 있습니다.',
  BROADCAST_CONFIRM_REQUIRED: '광고가 아님 확인 문장이 바뀌었습니다. 다시 읽고 확인해 주세요.',
  BROADCAST_INPUT_INVALID: '보낼 내용이 올바르지 않습니다.',
  BROADCAST_PII_SUSPECTED: '제목·내용에 개인정보로 보이는 글이 있습니다.',
  BROADCAST_IDEMPOTENCY_CONFLICT: '같은 보내기 요청에 다른 내용이 들어왔습니다. 미리보기를 다시 해 주세요.',
  BROADCAST_RATE_LIMITED: '보내기 상한에 걸렸습니다.',
  BROADCAST_COUNT_CHANGED: '받는 인원이 미리보기와 달라졌습니다. 미리보기를 다시 해 주세요.',
  BROADCAST_NOT_FOUND: '보낸 기록을 찾을 수 없습니다.',
} as const

export type MemberNotificationErrorCode = keyof typeof MEMBER_NOTIFICATION_ERROR_MESSAGES

export function extractMemberNotificationError(message: string | null | undefined): { code: MemberNotificationErrorCode; detail: string | null } | null {
  const match = (message ?? '').match(/\b(MEMBER_NOTIFICATION_[A-Z_]+|BROADCAST_[A-Z_]+)(?::([^\s]+))?/)
  if (!match || !(match[1] in MEMBER_NOTIFICATION_ERROR_MESSAGES)) return null
  return { code: match[1] as MemberNotificationErrorCode, detail: match[2] ?? null }
}

// 관리자 화면 칸 이름(오류 세부 경로 → 이름). 모르는 경로는 그대로 보인다.
export function memberNotificationFieldLabel(path: string): string {
  const [head, kind, field] = path.split('.')
  if (head === 'kinds' && kind && kind in MEMBER_NOTIFICATION_KINDS) {
    const label = MEMBER_NOTIFICATION_KINDS[kind as MemberNotificationKind].label
    const fieldLabel = field === 'title' ? '제목' : field === 'message' ? '내용' : field === 'enabled' ? '켜기' : field === 'categoryLabels' ? '분류 이름' : ''
    return fieldLabel ? `${label} ${fieldLabel}` : label
  }
  const named: Record<string, string> = {
    'marketRefundMessage.base': '마켓 환불 문장(돌려준 크레딧)',
    'marketRefundMessage.reissued': '마켓 환불 문장(다시 지급)',
    'marketRefundMessage.missing': '마켓 환불 문장(돌려주지 못한 몫)',
    'marketRefundMessage.unknown': '마켓 환불 문장(내역 모름)',
    'broadcast.memberLabel': '공지 머리표',
    'broadcast.allMembersDailyLimit': '전체 보내기 상한',
    'broadcast.selfTestDailyLimit': '시험 보내기 상한',
    'broadcast.notAdvertisingStatement': '광고가 아님 확인 문장',
    'broadcast.redactedText': '가림 문구',
    title: '제목',
    message: '내용',
    linkUrl: '연결',
    postId: '공지 글',
    target: '대상',
    expectedCount: '인원',
    reasonCode: '회수 사유',
    redact: '가림',
  }
  return named[path] ?? path
}

export function memberNotificationErrorMessage(error: { code: MemberNotificationErrorCode; detail: string | null }, piiLabels?: Record<string, string>): string {
  const base: string = MEMBER_NOTIFICATION_ERROR_MESSAGES[error.code]
  if (!error.detail) return base
  if (error.code === 'MEMBER_NOTIFICATION_INPUT_INVALID' || error.code === 'BROADCAST_INPUT_INVALID') return `${base} (${memberNotificationFieldLabel(error.detail)})`
  if (error.code === 'MEMBER_NOTIFICATION_PII_SUSPECTED' || error.code === 'BROADCAST_PII_SUSPECTED') {
    return `${base} (${error.detail.split(',').map((kind) => piiLabels?.[kind] ?? kind).join(', ')})`
  }
  if (error.code === 'BROADCAST_COUNT_CHANGED') return `${base} (지금 ${Number(error.detail).toLocaleString('ko-KR')}명)`
  if (error.code === 'BROADCAST_RATE_LIMITED') {
    const at = new Date(error.detail)
    return Number.isNaN(at.getTime()) ? base : `${base} 다음 가능 시각: ${at.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}`
  }
  return base
}
