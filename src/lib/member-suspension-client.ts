import {
  MEMBER_RESTRICTION_PAGE_PATH,
  MEMBER_SUSPENSION_FALLBACK_TEXTS,
  readSuspensionBlockCode,
  type MemberSuspensionBlockCode,
} from '@/lib/member-suspension'

// 12번 5-3: 막힌 동작(구매·장바구니·충전·후기 쓰기·추천)이 403 MEMBER_SUSPENDED·503 SUSPENSION_CHECK_FAILED 를 받으면
// 화면이 문구와 '자세히 보기'(안내 화면)를 보인다. 동의 막힘 처리(src/lib/consent-client.ts)와 같은 자리의 공용 처리다.
// 문구는 서버가 정책(texts.apiBlocked)으로 넣어 보낸 값을 쓰고, 없을 때만 대체 문구를 쓴다.
export interface MemberSuspensionNotice {
  code: MemberSuspensionBlockCode
  message: string
  // 안내 화면 주소(정지 확인 실패면 null — '잠시 후 다시 시도')
  href: string | null
}

function readMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const record = body as { error?: unknown }
  if (typeof record.error === 'string' && record.error.trim()) return record.error
  if (record.error && typeof record.error === 'object') {
    const message = (record.error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return null
}

export function readMemberSuspensionNotice(status: number, body: unknown): MemberSuspensionNotice | null {
  const code = readSuspensionBlockCode(status, body)
  if (!code) return null
  const suspended = code === 'MEMBER_SUSPENDED'
  return {
    code,
    message: readMessage(body) ?? (suspended ? MEMBER_SUSPENSION_FALLBACK_TEXTS.apiBlocked : MEMBER_SUSPENSION_FALLBACK_TEXTS.noticeCheckFailed),
    href: suspended ? MEMBER_RESTRICTION_PAGE_PATH : null,
  }
}

// 알림(toast)으로 보이는 화면용: '자세히 보기' 버튼을 붙인 옵션.
export function memberSuspensionToastOptions(notice: MemberSuspensionNotice) {
  const href = notice.href
  return href
    ? { action: { label: '자세히 보기', onClick: () => window.location.assign(href) } }
    : undefined
}
