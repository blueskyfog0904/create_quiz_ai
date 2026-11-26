// 회원에게 보이는 글의 개인정보 모양 판정(14번 계획 5-6, 16번이 같이 쓴다). DB public.member_facing_text_pii_hits 와 같은 규칙이다
// (예시 묶음 tests/fixtures/bundle14-pii-examples.json 을 TS 시험과 리허설이 같이 돌린다).
// 모양만 본다(이메일·휴대폰·일반 전화·주민번호). 회사 고객센터 연락처(하단 정보 customerCenter·orderEmail 값)는 뺀다 — 값은 DB 에서 받는다.
// 전화는 숫자만 남겨 비교한다(하이픈 유무 무관). 돌려주는 순서: email·mobile·phone·rrn.

export type MemberFacingPiiKind = 'email' | 'mobile' | 'phone' | 'rrn'

export interface MemberFacingPiiAllowed {
  customerCenter: string | null | undefined
  orderEmail: string | null | undefined
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)*[.][A-Za-z]{2,}/g
const MOBILE_PATTERN = /(?<![0-9])01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9])/g
const PHONE_PATTERN = /(?<![0-9])0(?:2|[3-6][1-5]|70)[-. ]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9])/g
const RRN_PATTERN = /(?<![0-9])[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[- ]?[1-8][0-9]{6}(?![0-9])/

const digitsOnly = (value: string) => value.replace(/[^0-9]/g, '')

export function memberFacingTextPiiHits(text: string | null | undefined, allowed: MemberFacingPiiAllowed): MemberFacingPiiKind[] {
  if (!text) return []
  const allowedPhone = digitsOnly(allowed.customerCenter ?? '')
  const allowedEmail = (allowed.orderEmail ?? '').trim().toLowerCase()
  const hits: MemberFacingPiiKind[] = []
  if ([...text.matchAll(EMAIL_PATTERN)].some((match) => match[0].toLowerCase() !== allowedEmail)) hits.push('email')
  if ([...text.matchAll(MOBILE_PATTERN)].some((match) => digitsOnly(match[0]) !== allowedPhone)) hits.push('mobile')
  if ([...text.matchAll(PHONE_PATTERN)].some((match) => digitsOnly(match[0]) !== allowedPhone)) hits.push('phone')
  if (RRN_PATTERN.test(text)) hits.push('rrn')
  return hits
}

export const MEMBER_FACING_PII_LABELS: Record<MemberFacingPiiKind, string> = {
  email: '이메일 주소',
  mobile: '휴대폰 번호',
  phone: '전화번호',
  rrn: '주민등록번호',
}
