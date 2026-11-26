// 13번 묶음(계획 docs/plan-bundle13-cs-tools.md 8절): 관리자가 회원 연락처(이메일·전화)를 본 일의 기록 — 순수 규칙만 둔다.
// 기록은 admin_member_access_log(추가 전용, DB 함수 record_admin_member_access)에 남고, 대표가 /admin/audit-log '개인정보 열람' 탭에서 본다.
// 화면 키는 코드 목록이다(DB 는 CHECK 로 묶지 않음 — 작업 기록 action 과 같은 방식). 화면을 더하면 여기에 한 줄을 더한다.
// 꺼진 기능(questions·ai 실행 기록)은 다시 켤 때 키를 더한다(계약 시험 허용 목록에 사유가 있다).
export const ADMIN_MEMBER_ACCESS_SCREENS = {
  'users.list': '회원 목록',
  'users.detail': '회원 상세',
  'support.list': '문의 목록',
  'support.ticket': '문의 상세',
  'orders.payments': '주문(충전)',
  'orders.market': '주문(자료)',
  'refunds.list': '환불 목록',
  'credits.list': '크레딧 내역',
  member_search: '회원 찾기(지급 창)',
  'reviews.list': '후기 목록',
  dashboard: '대시보드',
  audit_log: '작업 기록·열람 기록',
} as const

export type AdminMemberAccessScreen = keyof typeof ADMIN_MEMBER_ACCESS_SCREENS

// 기록하는 항목 이름(화면에 보인 것). 연락처 외에 12번 메모처럼 회원 상세에 함께 보이는 것도 적는다(16절).
export const ADMIN_MEMBER_ACCESS_FIELDS = {
  email: '이메일',
  phone: '전화번호',
  memo: '관리자 메모',
  answer_history: '이전 답변',
  // 대표가 '개인정보 열람' 탭에서 본 회원 표시 이름(이 탭을 연 것도 기록 — 8-3)
  access_log: '열람 기록',
} as const

export type AdminMemberAccessField = keyof typeof ADMIN_MEMBER_ACCESS_FIELDS

// 한 행에 담는 회원 수의 상한(DB CHECK 1~200 과 같은 규칙). 넘으면 나눠서 여러 행으로 남긴다(context.part).
export const MEMBER_ACCESS_LOG_BATCH_SIZE = 200

// 사유 칸 상한(DB CHECK 와 같음)
export const MEMBER_ACCESS_REASON_MAX = 200

export function isAdminMemberAccessScreen(value: string): value is AdminMemberAccessScreen {
  return Object.prototype.hasOwnProperty.call(ADMIN_MEMBER_ACCESS_SCREENS, value)
}

// 기록 인자 만들기: 빈 값·중복을 빼고 200명씩 나눈다. 회원이 0명이면 빈 배열(부르지 않는다).
export function buildMemberAccessBatches(memberIds: readonly (string | null | undefined)[]): string[][] {
  const unique = [...new Set(memberIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const batches: string[][] = []
  for (let index = 0; index < unique.length; index += MEMBER_ACCESS_LOG_BATCH_SIZE) {
    batches.push(unique.slice(index, index + MEMBER_ACCESS_LOG_BATCH_SIZE))
  }
  return batches
}

// 목록 화면의 전화번호 가리기(Q3 가): 가운데 자리를 *로 바꾸고 끝 4자리만 남긴다. 010-1234-5678 → 010-****-5678.
// 숫자가 7자리보다 짧으면 모두 가린다. 빈 값은 그대로(null).
export function maskPhone(phone: string | null | undefined): string | null {
  if (typeof phone !== 'string') return null
  const trimmed = phone.trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 7) return '*'.repeat(Math.max(digits.length, 4))
  const head = digits.slice(0, 3)
  const tail = digits.slice(-4)
  const middle = '*'.repeat(Math.max(digits.length - 7, 3))
  return `${head}-${middle}-${tail}`
}
