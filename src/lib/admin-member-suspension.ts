import type { MemberDeadlineKind, MemberSuspensionScope } from '@/lib/member-suspension'

// 12번 묶음 관리자 화면 규칙(순수 함수). 회원 화면 문구는 DB(정책 texts)이고, 여기 있는 것은 관리자 화면 이름표다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export const SUSPENSION_SCOPE_LABELS: Record<MemberSuspensionScope, string> = {
  restricted: '이용 제한',
  login_blocked: '로그인 차단',
}

export const SUSPENSION_NOTICE_VIA_LABELS = {
  screen: '화면 안내',
  email: '이메일',
  phone: '전화',
} as const

export const MEMBER_DEADLINE_KIND_LABELS: Record<MemberDeadlineKind, string> = {
  chargeRefund: '충전 환불 신청 기한',
  materialRefund: '자료 환불 신청 기한',
  creditExpiry: '유료 크레딧 소멸일',
}

// 한국 날짜(YYYY-MM-DD)의 끝 = 다음 날 00:00 KST(ISO). 모양이 다르면 null.
export function kstEndOfDayIso(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1) - KST_OFFSET_MS
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

// 고를 수 있는 가장 늦은 한국 날짜: 그날 끝(다음 날 00:00 KST)이 지금 + 최대 일수 이하인 날(DB 검사와 같은 기준).
export function latestRestrictedEndDate(nowMs: number, maxDays: number): string {
  const limit = nowMs + maxDays * DAY_MS
  const kst = new Date(limit + KST_OFFSET_MS)
  // limit 이 속한 한국 날짜의 '전날'까지는 그날 끝이 limit 이하다(그날 자체는 끝이 limit 보다 뒤일 수 있음).
  const candidate = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - 1))
  return candidate.toISOString().slice(0, 10)
}

// 오늘(한국 날짜) — 끝나는 날 입력의 최솟값
export function kstToday(nowMs: number): string {
  return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10)
}

// 대표 이메일 기한 안내 초안(ownerMailDeadlines 틀의 {기한 종류}·{날짜}를 채움). 기한이 없으면 틀 그대로.
// {기한 종류}는 회원이 읽는 글이라 정책 문구(texts.deadline*)로 채운다.
export function fillOwnerMailDeadlines(template: string, earliest: { kindLabel: string; dateLabel: string } | null) {
  if (!earliest) return template
  return template.replaceAll('{기한 종류}', earliest.kindLabel).replaceAll('{날짜}', earliest.dateLabel)
}
