import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import {
  MEMBER_RESTRICTION_PAGE_PATH,
  MEMBER_SUSPENSION_FALLBACK_TEXTS,
  formatMemberDay,
  formatMemberLastDay,
  type MemberRefundDeadlines,
  type MemberSuspensionPolicy,
} from '@/lib/member-suspension'
import { getMemberSuspensionPolicyCached } from '@/lib/member-suspension-policy-server'
import {
  isMemberRestrictionPreviewEnabled,
  markMemberSuspensionSeen,
  readMemberRestrictionNotice,
  type MemberActiveSuspensionView,
} from '@/lib/member-suspension-server'

// 12번 5-3: 계정 이용 제한 안내 화면. 막힌 것·아직 되는 것·사유·이의 방법·환불 기한을 보인다.
// 문구는 모두 정책(member_suspension_policy.texts)이다. 처음 열면 first_seen_at 을 남긴다(화면 알림의 증빙, 실패해도 화면은 그림).
// 다운로드 route 가 막히면 이 화면으로 303 이동한다(확인 실패는 ?check=failed).
export const metadata: Metadata = {
  title: '계정 이용 제한 안내',
}

// 날짜 셈법은 공용 함수 하나(formatMemberLastDay·formatMemberDay)다 — 대표 이메일 초안과 같은 날짜가 나온다.

function Notice({ title, children }: { title?: string | null; children: ReactNode }) {
  return (
    <section className="grid gap-1.5 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] px-4 py-3">
      {title && <h2 className="text-sm font-bold text-[var(--studio-ink)]">{title}</h2>}
      <div className="whitespace-pre-line text-sm text-[var(--studio-muted)]">{children}</div>
    </section>
  )
}

// 기한 줄 이름은 정책 문구(texts.deadline*)다.
function DeadlineList({ deadlines, texts }: { deadlines: MemberRefundDeadlines | null; texts: MemberSuspensionPolicy['texts'] }) {
  if (!deadlines) return null
  const rows = [
    deadlines.chargeRefundUntil ? [texts.deadlineChargeRefund, formatMemberLastDay(deadlines.chargeRefundUntil)] : null,
    deadlines.materialRefundUntil ? [texts.deadlineMaterialRefund, formatMemberLastDay(deadlines.materialRefundUntil)] : null,
    deadlines.earliestCreditExpiry ? [texts.deadlineCreditExpiry, formatMemberLastDay(deadlines.earliestCreditExpiry)] : null,
  ].filter((row): row is [string, string] => row !== null)
  if (rows.length === 0) return null
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[var(--studio-ink)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-medium">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default async function MemberRestrictionPage({ searchParams }: { searchParams: Promise<{ check?: string }> }) {
  await connection()

  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent(MEMBER_RESTRICTION_PAGE_PATH)}`)
  }

  const [{ check }, policy] = await Promise.all([searchParams, getMemberSuspensionPolicyCached()])
  const preview = isMemberRestrictionPreviewEnabled()
  const result: Awaited<ReturnType<typeof readMemberRestrictionNotice>> = check === 'failed' && !preview
    ? { ok: false }
    : preview
      ? { ok: true, suspension: previewSuspension(policy), deadlines: null }
      : await readMemberRestrictionNotice(userId)

  if (!result.ok || !policy) {
    return (
      <section className="grid gap-4">
        <h1 className="text-xl font-bold text-[var(--studio-ink)]">{policy?.texts.noticeTitle}</h1>
        <p role="alert" className="text-sm text-[var(--studio-muted)]">
          {policy?.texts.noticeCheckFailed ?? MEMBER_SUSPENSION_FALLBACK_TEXTS.noticeCheckFailed}
        </p>
      </section>
    )
  }

  const { texts } = policy
  const suspension = result.suspension
  if (!suspension) {
    return (
      <section className="grid gap-4">
        <h1 className="text-xl font-bold text-[var(--studio-ink)]">{texts.noticeTitle}</h1>
        <p className="text-sm text-[var(--studio-muted)]">{texts.noticeNone}</p>
      </section>
    )
  }

  if (!preview && !suspension.firstSeenAt) {
    await markMemberSuspensionSeen(userId)
  }

  return (
    <section className="grid gap-4">
      <h1 className="text-xl font-bold text-[var(--studio-ink)]">{texts.noticeTitle}</h1>
      <p className="whitespace-pre-line text-sm text-[var(--studio-ink)]">{texts.noticeIntro}</p>
      <Notice>
        {formatMemberDay(suspension.startsAt)} ~ {suspension.endsAt ? formatMemberLastDay(suspension.endsAt) : texts.noticeUntilLifted}
      </Notice>
      <Notice title={suspension.reasonLabel || null}>{suspension.memberReason}</Notice>
      <Notice>
        {texts.noticeBlockedList}
        {suspension.blocksDownload ? `\n${texts.noticeBlockedDownload}` : ''}
      </Notice>
      <Notice>{texts.noticeAvailableList}</Notice>
      <Notice>
        {texts.noticeDeadlines}
        <DeadlineList deadlines={result.deadlines} texts={texts} />
      </Notice>
      <Notice>{texts.noticeObjection}</Notice>
    </section>
  )
}

// 개발 전용 미리보기(10절 4단계): DB 에 쓰지 않고 첫 사유 분류로 그린다.
function previewSuspension(policy: Awaited<ReturnType<typeof getMemberSuspensionPolicyCached>>): MemberActiveSuspensionView {
  const category = policy?.reasonCategories.find((item) => !item.hidden)
  return {
    id: 'preview',
    scope: 'restricted',
    blocksDownload: category?.blocksDownloadDefault ?? true,
    reasonCode: category?.code ?? '',
    reasonLabel: category?.label ?? '',
    memberReason: '[미리보기] 회원에게 알린 사유가 이 자리에 보입니다.',
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    firstSeenAt: null,
  }
}
