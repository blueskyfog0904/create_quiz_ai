import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { getRequestAuthUserId } from '@/lib/request-auth'
import {
  readMemberWithdrawalNotice,
  readMemberWithdrawalPolicy,
  readMemberWithdrawalPreview,
} from '@/lib/member-withdrawal-server'
import {
  fillWithdrawalScreenText,
  MEMBER_WITHDRAWAL_ERRORS,
  memberWithdrawalErrorCode,
  splitWithdrawalNotice,
  withdrawalBlockMessages,
  withdrawalText,
  type MemberWithdrawalPolicy,
  type MemberWithdrawalPreview,
} from '@/lib/member-withdrawal'
import { getConsentSenderName, readSignupConsentTexts } from '@/lib/signup-consent-server'
import {
  WithdrawView,
  type WithdrawMarketing,
  type WithdrawOption,
  type WithdrawScreen,
  type WithdrawTexts,
} from './_components/withdraw-view'

export const metadata: Metadata = {
  title: '회원 탈퇴',
  description: '회원 탈퇴 전에 사라지는 것과 보관하는 기록을 확인하고 탈퇴하거나 탈퇴를 요청합니다.',
}

// 화면 문구는 모두 DB(member_withdrawal_policy.texts). 자리표시 {비결제문의보존기간} {결제대기일} {가능예정일} 만 코드가 채운다.
function screenTexts(policy: MemberWithdrawalPolicy): WithdrawTexts {
  const years = { nonPayerTicketYears: policy.nonPayerTicketRetentionYears }
  const text = (path: string) => fillWithdrawalScreenText(withdrawalText(policy, path), years)
  return {
    confirmLabel: text('confirmLabel'),
    checkForfeit: text('checks.forfeit'),
    checkRecords: text('checks.records'),
    checkIrreversible: text('checks.irreversible'),
    ticketChoiceTitle: text('ticketRetentionChoice.title'),
    ticketChoicePurpose: text('ticketRetentionChoice.purpose'),
    ticketChoiceAgree: text('ticketRetentionChoice.agree'),
    ticketChoiceDisagree: text('ticketRetentionChoice.disagree'),
    reviewPendingNotice: text('reviewPendingNotice'),
    refundLinkLabel: text('refundLinkLabel'),
    marketingOnlyButton: text('marketingOnlyButton'),
    marketingOnlyDone: text('marketingOnlyDone'),
    objectionGuide: text('objectionGuide'),
    requestCreated: text('requestCreated'),
    requestCanceled: text('requestCanceled'),
    requestPending: text('blockReasons.REQUEST_PENDING'),
    completionTitle: text('completionTitle'),
    completionDeleted: text('completionDeleted'),
    finishDeleteNotice: text('finishDeleteNotice'),
    finishDeleteButton: text('finishDeleteButton'),
  }
}

async function noticeFor(userId: string, kind: 'self' | 'request', retention: boolean | null, confirmLabel: string | null) {
  const notice = await readMemberWithdrawalNotice(userId, kind, retention)
  if (!notice.ok) return null
  return { ...splitWithdrawalNotice(notice.data.text, confirmLabel), sha256: notice.data.sha256, expectedBalance: notice.data.expectedBalance }
}

// 비결제 회원의 한 경로(문의 보존 선택별): 완전 삭제 / 익명화(가능·막힘)
async function nonPayerOption(
  userId: string,
  preview: MemberWithdrawalPreview,
  policy: MemberWithdrawalPolicy,
  retention: boolean | null,
  confirmLabel: string | null
): Promise<WithdrawOption> {
  const fullDelete = retention === false ? preview.fullDeleteIfTicketsDeleted : preview.fullDeleteAllowed
  const allowed = retention === false ? preview.selfAllowedIfTicketsDeleted : preview.selfAllowed
  const reasons = retention === false ? preview.selfReasonsIfTicketsDeleted : preview.selfReasons
  if (!fullDelete && !allowed) {
    return { mode: 'self', notice: null, block: withdrawalBlockMessages(reasons, preview, policy) }
  }
  const notice = await noticeFor(userId, 'self', retention ?? true, confirmLabel)
  return notice
    ? { mode: fullDelete ? 'full_delete' : 'self', notice, block: null }
    : { mode: 'self', notice: null, block: { lines: [MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_POLICY_UNAVAILABLE.message], review: false, refundLink: false } }
}

// 막힘 화면의 [광고 수신 동의만 지금 철회]: 마케팅 동의 중이면 항목(정책의 marketingConsentItemKey)을 넘긴다.
async function readMarketingItem(policy: MemberWithdrawalPolicy) {
  if (!policy.marketingConsentItemKey) return null
  const { data } = await createAdminClient().from('signup_consent_items')
    .select('id, version, label').eq('key', policy.marketingConsentItemKey).maybeSingle()
  return data ?? null
}

async function buildScreen(userId: string): Promise<{ screen: WithdrawScreen; texts: WithdrawTexts | null }> {
  const policy = await readMemberWithdrawalPolicy()
  const previewResult = await readMemberWithdrawalPreview(userId, null)
  // 완전 삭제 중 프로필은 지웠는데 로그인 계정 삭제가 실패한 회원(관리자는 프로필이 있어 해당 없음): 탈퇴 마무리 폼.
  // route(/api/auth/withdraw)가 같은 조건(프로필 없음 + MEMBER_WITHDRAW_USER_NOT_FOUND)을 다시 보고 로그인 계정 삭제만 마저 한다.
  if (policy && !previewResult.ok && memberWithdrawalErrorCode(previewResult.error.message) === 'MEMBER_WITHDRAW_USER_NOT_FOUND') {
    const { data: profile, error: profileError } = await createAdminClient().from('profiles').select('id').eq('id', userId).maybeSingle()
    if (!profileError && !profile) {
      return { screen: { kind: 'finish_delete' }, texts: screenTexts(policy) }
    }
  }
  // 정책·미리보기를 읽지 못하면 폼을 보여 주지 않는다(DB 적용 전·설정 오류). 판정 없이 지우지 않게.
  if (!policy || !previewResult.ok) {
    return { screen: { kind: 'unavailable', message: MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_POLICY_UNAVAILABLE.message }, texts: null }
  }
  const preview = previewResult.data
  const texts = screenTexts(policy)
  if (preview.isAdmin) {
    return { screen: { kind: 'admin', message: withdrawalText(policy, 'blockReasons.ADMIN') ?? MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_ADMIN.message }, texts }
  }

  const [marketingItem, consentTexts, senderName] = await Promise.all([
    preview.marketingAgreed ? readMarketingItem(policy) : Promise.resolve(null),
    readSignupConsentTexts(),
    getConsentSenderName(),
  ])
  const marketing: WithdrawMarketing = {
    item: marketingItem ? { id: marketingItem.id, version: marketingItem.version, label: marketingItem.label } : null,
    resultTemplate: consentTexts?.optionalResultTemplate ?? null,
    senderName,
  }

  if (preview.hadPayment) {
    if (preview.openRequest) {
      return {
        screen: {
          kind: 'open_request',
          request: {
            id: preview.openRequest.id,
            receivedAt: preview.openRequest.receivedAt,
            expectedBalance: preview.openRequest.expectedBalance,
            marketingWithdrawnAt: preview.openRequest.marketingWithdrawnAt,
          },
          marketing,
        },
        texts,
      }
    }
    const option: WithdrawOption = preview.requestAllowed
      ? await noticeFor(userId, 'request', null, texts.confirmLabel).then((notice) => notice
          ? { mode: 'request' as const, notice, block: null }
          : { mode: 'request' as const, notice: null, block: { lines: [MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_POLICY_UNAVAILABLE.message], review: false, refundLink: false } })
      : { mode: 'request', notice: null, block: withdrawalBlockMessages(preview.requestReasons, preview, policy) }
    return { screen: { kind: 'form', ticketChoice: false, single: option, keep: null, remove: null, marketing }, texts }
  }

  if (preview.ticketCount > 0) {
    const [keep, remove] = await Promise.all([
      nonPayerOption(userId, preview, policy, true, texts.confirmLabel),
      nonPayerOption(userId, preview, policy, false, texts.confirmLabel),
    ])
    return { screen: { kind: 'form', ticketChoice: true, single: null, keep, remove, marketing }, texts }
  }
  const single = await nonPayerOption(userId, preview, policy, null, texts.confirmLabel)
  return { screen: { kind: 'form', ticketChoice: false, single, keep: null, remove: null, marketing }, texts }
}

export default async function WithdrawPage() {
  await connection()

  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(`/login?next=${encodeURIComponent('/mypage/withdraw')}`)
  }

  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()

  // 최종 판정은 route(/api/auth/withdraw)가 미리보기로 다시 한다. 회원 화면에는 필요한 값만 보낸다(가림 대상 문의 제목 등은 보내지 않음).
  let state: Awaited<ReturnType<typeof buildScreen>>
  try {
    state = await buildScreen(userId)
  } catch (error) {
    console.error('Withdraw screen lookup error:', error instanceof Error ? error.message : error)
    state = { screen: { kind: 'unavailable', message: MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_POLICY_UNAVAILABLE.message }, texts: null }
  }

  return (
    <Suspense fallback={null}>
      <WithdrawView email={authData.user?.email || ''} screen={state.screen} texts={state.texts} />
    </Suspense>
  )
}
