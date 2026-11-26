// 관리자 화면 숫자·날짜 표기(20번 5-1). 순수 함수만 둔다. 시간대는 Asia/Seoul 고정.
// 값이 없으면 '–', 세지 못한 값(조회 실패 등)은 '확인 불가'. 세지 못한 값은 ADMIN_UNAVAILABLE 로 넘긴다.

export const ADMIN_UNAVAILABLE = 'unavailable' as const
export const ADMIN_EMPTY_TEXT = '–'
export const ADMIN_UNAVAILABLE_TEXT = '확인 불가'

export type AdminNumberValue = number | null | undefined | typeof ADMIN_UNAVAILABLE

// 음수 부호는 글자 폭이 같은 '−'(U+2212)를 쓴다.
const MINUS = '−'

const integerFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })

function readNumber(value: AdminNumberValue): number | string {
  if (value === ADMIN_UNAVAILABLE) return ADMIN_UNAVAILABLE_TEXT
  if (value === null || value === undefined) return ADMIN_EMPTY_TEXT
  if (!Number.isFinite(value)) return ADMIN_UNAVAILABLE_TEXT
  return value
}

function formatInteger(value: number) {
  const text = integerFormat.format(Math.abs(Math.round(value)))
  return Math.round(value) < 0 ? `${MINUS}${text}` : text
}

// 9900 → "9,900원"
export function formatWon(value: AdminNumberValue): string {
  const number = readNumber(value)
  return typeof number === 'string' ? number : `${formatInteger(number)}원`
}

// 3000 → "3,000 C"
export function formatCredits(value: AdminNumberValue): string {
  const number = readNumber(value)
  return typeof number === 'string' ? number : `${formatInteger(number)} C`
}

// 크레딧 증감: +3,000 C / −3,000 C / 0 C. 색은 정하지 않는다(사용 차감은 기본 글자색, 20번 Q6).
export function formatSignedCredits(value: AdminNumberValue): string {
  const number = readNumber(value)
  if (typeof number === 'string') return number
  const rounded = Math.round(number)
  if (rounded === 0) return '0 C'
  return `${rounded > 0 ? '+' : ''}${formatInteger(rounded)} C`
}

// 1234 → "1,234", 단위를 주면 "1,234건"
export function formatCount(value: AdminNumberValue, unit = ''): string {
  const number = readNumber(value)
  return typeof number === 'string' ? number : `${formatInteger(number)}${unit}`
}

const kstPartsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type AdminDateValue = string | number | Date | null | undefined

function readKstParts(value: AdminDateValue) {
  if (value === null || value === undefined || value === '') return ADMIN_EMPTY_TEXT
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ADMIN_UNAVAILABLE_TEXT
  const parts = Object.fromEntries(kstPartsFormat.formatToParts(date).map((part) => [part.type, part.value]))
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute }
}

// "11-19 10:44" (한국 시간)
export function formatKstShort(value: AdminDateValue): string {
  const parts = readKstParts(value)
  return typeof parts === 'string' ? parts : `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

// "2026-11-19 10:44" (한국 시간)
export function formatKstFull(value: AdminDateValue): string {
  const parts = readKstParts(value)
  return typeof parts === 'string' ? parts : `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

// "14:02" (한국 시간) — 저장 바의 '14:02 저장됨' 등
export function formatKstTime(value: AdminDateValue): string {
  const parts = readKstParts(value)
  return typeof parts === 'string' ? parts : `${parts.hour}:${parts.minute}`
}

export type AdminDeltaDirection = 'up' | 'down' | 'flat' | 'unavailable'

export interface AdminDelta {
  direction: AdminDeltaDirection
  // 부호 없는 글. 방향은 ▲▼ 기호로 따로 보인다.
  text: string
}

// 지난 기간 대비 증감. 앞 기간이 0 이면 비율 대신 "이전 0 → 신규".
export function formatDelta(current: AdminNumberValue, previous: AdminNumberValue): AdminDelta {
  const now = readNumber(current)
  const before = readNumber(previous)
  if (typeof now === 'string' || typeof before === 'string') return { direction: 'unavailable', text: ADMIN_UNAVAILABLE_TEXT }
  if (now === before) return { direction: 'flat', text: '변화 없음' }
  if (before === 0) return { direction: now > 0 ? 'up' : 'down', text: '이전 0 → 신규' }
  const percent = (Math.abs(now - before) / Math.abs(before)) * 100
  return { direction: now > before ? 'up' : 'down', text: `${percent.toFixed(1)}%` }
}
