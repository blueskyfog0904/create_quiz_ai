'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { StudioAlertDialog } from '@/components/design-system/studio-dialog'
import { createClient } from '@/lib/supabase/client'
import { formatOptionalResult, getConsentErrorMessage } from '@/lib/signup-consent'
import { formatKstDateTime } from '@/lib/kst-date-format'
import type { WithdrawalBlock } from '@/lib/member-withdrawal'
import { setOptionalConsentAction } from '../../consents/actions'

const controlClassName =
  'min-h-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'
const cardClassName = 'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 sm:p-7'
const primaryButtonClassName =
  'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--studio-radius-control)] bg-[var(--studio-primary)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--studio-primary-hover)] disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'
const outlineButtonClassName =
  'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-4 text-sm font-semibold text-[var(--studio-ink)] transition-colors hover:bg-[var(--studio-background-sunken)] disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

// 화면 문구(모두 DB member_withdrawal_policy.texts, 서버가 자리표시를 채운 값). 없으면 null.
export interface WithdrawTexts {
  confirmLabel: string | null
  checkForfeit: string | null
  checkRecords: string | null
  checkIrreversible: string | null
  ticketChoiceTitle: string | null
  ticketChoicePurpose: string | null
  ticketChoiceAgree: string | null
  ticketChoiceDisagree: string | null
  reviewPendingNotice: string | null
  refundLinkLabel: string | null
  marketingOnlyButton: string | null
  marketingOnlyDone: string | null
  objectionGuide: string | null
  requestCreated: string | null
  requestCanceled: string | null
  requestPending: string | null
  completionTitle: string | null
  completionDeleted: string | null
  finishDeleteNotice: string | null
  finishDeleteButton: string | null
}

// 고지 원문(서버가 만든 것)과 지문. 화면은 그대로 보여 주고 지문을 돌려보낸다.
export interface WithdrawNotice {
  title: string
  lines: string[]
  sha256: string
  expectedBalance: number
}

export interface WithdrawOption {
  mode: 'full_delete' | 'self' | 'request'
  notice: WithdrawNotice | null
  block: WithdrawalBlock | null
}

export interface WithdrawMarketing {
  // 마케팅 동의 중일 때만(막힘 화면의 광고 수신 동의만 철회)
  item: { id: string; version: number; label: string } | null
  resultTemplate: string | null
  senderName: string
}

export type WithdrawScreen =
  | { kind: 'unavailable'; message: string }
  | { kind: 'admin'; message: string }
  // 완전 삭제가 프로필 삭제 뒤 멈춘 회원: 로그인 계정 삭제만 마저 한다
  | { kind: 'finish_delete' }
  | {
      kind: 'open_request'
      request: { id: string; receivedAt: string; expectedBalance: number; marketingWithdrawnAt: string | null }
      marketing: WithdrawMarketing
    }
  | {
      kind: 'form'
      // 문의가 있는 비결제 회원은 보존 선택(keep/remove)마다 경로가 다르다.
      ticketChoice: boolean
      single: WithdrawOption | null
      keep: WithdrawOption | null
      remove: WithdrawOption | null
      marketing: WithdrawMarketing
    }

type MarketingResult = { sender: string | null; withdrawnAt: string; result: string | null } | null

type Done =
  // kept: 익명화 완료 때 보관하는 기록 줄(서버가 결과에 맞게 고른 DB 문구)
  | { kind: 'deleted' | 'anonymized'; marketing: MarketingResult; kept: string[] }
  | { kind: 'request_created'; marketing: MarketingResult }

interface WithdrawViewProps {
  email: string
  screen: WithdrawScreen
  texts: WithdrawTexts | null
}

function MarketingResultLine({ marketing, label, template }: { marketing: MarketingResult; label: string | null; template: string | null }) {
  if (!marketing) return null
  const line = template && label && marketing.sender
    ? formatOptionalResult(template, { sender: marketing.sender, itemLabel: label, agreed: false, processedAt: marketing.withdrawnAt })
    : [marketing.sender, marketing.result, formatKstDateTime(marketing.withdrawnAt)].filter(Boolean).join(' · ')
  return <p role="status" className="mt-3 rounded-[var(--studio-radius-control)] bg-[var(--studio-background-sunken)] px-4 py-3 text-sm text-[var(--studio-ink)] break-keep">{line}</p>
}

function BlockPanel({ block, texts, marketing, ticketRetentionAgreed }: {
  block: WithdrawalBlock
  texts: WithdrawTexts | null
  marketing: WithdrawMarketing
  ticketRetentionAgreed: boolean | null
}) {
  const [reviewDone, setReviewDone] = useState<string | null>(null)
  const [marketingDone, setMarketingDone] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const requestReview = async () => {
    setPending(true)
    try {
      const response = await fetch('/api/auth/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_review', ticketRetentionAgreed }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '요청하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      setReviewDone(data.message || texts?.reviewPendingNotice || '')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '요청하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  // 광고 수신 동의만 지금 철회(source mypage, 결과를 이 화면에서 바로 알린다)
  const withdrawMarketing = async () => {
    if (!marketing.item) return
    setPending(true)
    try {
      const outcome = await setOptionalConsentAction(marketing.item.id, marketing.item.version, false)
      if (!outcome.ok) {
        toast.error(getConsentErrorMessage(outcome.code))
        return
      }
      const record = outcome.results.find((candidate) => candidate.item_id === marketing.item?.id)
      const result = record && marketing.resultTemplate
        ? formatOptionalResult(marketing.resultTemplate, {
            sender: marketing.senderName,
            itemLabel: marketing.item.label,
            agreed: record.agreed,
            processedAt: record.created_at,
          })
        : null
      setMarketingDone([texts?.marketingOnlyDone, result].filter(Boolean).join(' '))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={cardClassName}>
      <div className="rounded-[var(--studio-radius-control)] bg-red-50 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-red-800 break-keep">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          지금은 탈퇴할 수 없습니다
        </h2>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-red-700 break-keep">
          {block.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>
      <div className="mt-6 space-y-3">
        {block.refundLink && texts?.refundLinkLabel && (
          <Link href="/mypage/credits" className={primaryButtonClassName}>{texts.refundLinkLabel}</Link>
        )}
        {block.review && (
          reviewDone !== null
            ? <p role="status" className="text-sm text-[var(--studio-ink)] break-keep">{reviewDone}</p>
            : (
              <button type="button" onClick={() => void requestReview()} disabled={pending} className={outlineButtonClassName}>
                담당자 확인 요청하기
              </button>
            )
        )}
        {marketing.item && texts?.marketingOnlyButton && (
          marketingDone !== null
            ? <p role="status" className="text-sm text-[var(--studio-ink)] break-keep">{marketingDone}</p>
            : (
              <button type="button" onClick={() => void withdrawMarketing()} disabled={pending} className={outlineButtonClassName}>
                {texts.marketingOnlyButton}
              </button>
            )
        )}
        {texts?.objectionGuide && <p className="text-xs text-[var(--studio-muted)] break-keep">{texts.objectionGuide}</p>}
      </div>
    </section>
  )
}

function WithdrawForm({ email, option, texts, ticketRetentionAgreed, onDone }: {
  email: string
  option: WithdrawOption & { notice: WithdrawNotice }
  texts: WithdrawTexts
  ticketRetentionAgreed: boolean | null
  onDone: (done: Done) => void
}) {
  const router = useRouter()
  const [confirmEmail, setConfirmEmail] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  // ① 소멸 동의(사라지는 크레딧이 있을 때) ② 기록 보존·삭제 안내 확인 ③ 되돌릴 수 없음 ④ 최종 확인(고지 원문 마지막 줄)
  const checks = [
    option.notice.expectedBalance > 0 ? { key: 'forfeit', label: texts.checkForfeit } : null,
    { key: 'records', label: texts.checkRecords },
    { key: 'irreversible', label: texts.checkIrreversible },
    { key: 'final', label: texts.confirmLabel },
  ].filter((item): item is { key: string; label: string } => Boolean(item?.label))
  const allChecked = checks.every((item) => checked[item.key])
  const emailMatches = confirmEmail === email
  const isRequest = option.mode === 'request'

  const submit = async () => {
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/auth/withdraw', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmEmail,
          ticketRetentionAgreed,
          noticeSha256: option.notice.sha256,
          expectedBalance: option.notice.expectedBalance,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        // 고지·금액이 바뀌었으면 새 고지를 불러오고 체크를 처음부터 다시 받는다.
        if (data.code === 'MEMBER_WITHDRAW_NOTICE_INVALID' || data.code === 'MEMBER_WITHDRAW_BALANCE_CHANGED') {
          setChecked({})
          router.refresh()
        }
        throw new Error(data.error || '회원 탈퇴에 실패했습니다.')
      }
      if (data.kind === 'request_created') {
        onDone({ kind: 'request_created', marketing: data.marketing ?? null })
        return
      }
      // 계정이 정리되었으므로 이 기기의 세션도 지운다(이미 서버에서 끊겨 실패해도 괜찮다).
      await createClient().auth.signOut().catch(() => undefined)
      onDone({
        kind: data.kind === 'deleted' ? 'deleted' : 'anonymized',
        marketing: data.marketing ?? null,
        kept: Array.isArray(data.kept) ? data.kept.filter((line: unknown): line is string => typeof line === 'string') : [],
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '회원 탈퇴에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
      setShowConfirmDialog(false)
    }
  }

  return (
    <section className={cardClassName}>
      <div className="rounded-[var(--studio-radius-control)] bg-red-50 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-red-800 break-keep">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          {option.notice.title}
        </h2>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-red-700 break-keep">
          {option.notice.lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
      </div>

      <div className="mt-6 space-y-1">
        {checks.map((item) => (
          <label
            key={item.key}
            htmlFor={`withdraw-${item.key}`}
            className="flex min-h-9 cursor-pointer items-center gap-3 rounded-[var(--studio-radius-control)] text-sm leading-relaxed text-[var(--studio-ink)] break-keep"
          >
            <input
              id={`withdraw-${item.key}`}
              type="checkbox"
              checked={checked[item.key] === true}
              onChange={(event) => setChecked((prev) => ({ ...prev, [item.key]: event.target.checked }))}
              className="size-4 shrink-0 accent-[var(--studio-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            />
            {item.label}
          </label>
        ))}
      </div>

      <div className="mt-6">
        <label htmlFor="confirmEmail" className="block text-sm font-medium text-[var(--studio-ink)] break-keep">
          본인 확인을 위해 이메일 주소를 입력해주세요
        </label>
        <input
          id="confirmEmail"
          type="email"
          value={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.value)}
          placeholder={email}
          className={`mt-2 ${controlClassName}`}
        />
        {confirmEmail && !emailMatches && (
          <p className="mt-2 text-sm text-red-500 break-keep">이메일 주소가 일치하지 않습니다.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          if (!allChecked || !emailMatches) {
            toast.error('모든 항목에 동의하고 이메일을 정확히 입력해주세요.')
            return
          }
          setShowConfirmDialog(true)
        }}
        disabled={!allChecked || !emailMatches || isSubmitting}
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--studio-radius-control)] border border-red-500 bg-[var(--studio-surface)] px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500 hover:text-white disabled:opacity-50 disabled:hover:bg-[var(--studio-surface)] disabled:hover:text-red-600 outline-none focus-visible:ring-2 focus-visible:ring-red-300"
      >
        {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        {isSubmitting ? '처리 중…' : isRequest ? '탈퇴 요청하기' : '회원 탈퇴하기'}
      </button>

      <StudioAlertDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        title={isRequest ? '탈퇴를 요청할까요?' : '정말 탈퇴하시겠어요?'}
        description={texts.checkIrreversible ?? ''}
        cancelLabel="취소"
        confirmLabel={isRequest ? '요청하기' : '탈퇴하기'}
        destructive
        pending={isSubmitting}
        onConfirm={() => void submit()}
      />
    </section>
  )
}

// 탈퇴 마무리(완전 삭제가 프로필 삭제 뒤 멈춘 회원): 이메일 확인 → DELETE(route 가 로그인 계정 삭제만 마저 한다)
function FinishDeleteForm({ email, texts, onDone }: { email: string; texts: WithdrawTexts; onDone: (done: Done) => void }) {
  const [confirmEmail, setConfirmEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const emailMatches = confirmEmail === email

  const submit = async () => {
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/auth/withdraw', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '회원 탈퇴에 실패했습니다.')
      await createClient().auth.signOut().catch(() => undefined)
      onDone({ kind: 'deleted', marketing: data.marketing ?? null, kept: [] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '회원 탈퇴에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className={cardClassName}>
      {texts.finishDeleteNotice && <p className="text-sm text-[var(--studio-ink)] break-keep">{texts.finishDeleteNotice}</p>}
      <div className="mt-6">
        <label htmlFor="finishConfirmEmail" className="block text-sm font-medium text-[var(--studio-ink)] break-keep">
          본인 확인을 위해 이메일 주소를 입력해주세요
        </label>
        <input
          id="finishConfirmEmail"
          type="email"
          value={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.value)}
          placeholder={email}
          className={`mt-2 ${controlClassName}`}
        />
        {confirmEmail && !emailMatches && (
          <p className="mt-2 text-sm text-red-500 break-keep">이메일 주소가 일치하지 않습니다.</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!emailMatches || isSubmitting}
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--studio-radius-control)] border border-red-500 bg-[var(--studio-surface)] px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500 hover:text-white disabled:opacity-50 disabled:hover:bg-[var(--studio-surface)] disabled:hover:text-red-600 outline-none focus-visible:ring-2 focus-visible:ring-red-300"
      >
        {isSubmitting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        {isSubmitting ? '처리 중…' : texts.finishDeleteButton}
      </button>
    </section>
  )
}

function OptionPanel({ email, option, texts, marketing, ticketRetentionAgreed, onDone }: {
  email: string
  option: WithdrawOption
  texts: WithdrawTexts
  marketing: WithdrawMarketing
  ticketRetentionAgreed: boolean | null
  onDone: (done: Done) => void
}) {
  if (option.block || !option.notice) {
    return <BlockPanel block={option.block ?? { lines: [], review: false, refundLink: false }} texts={texts} marketing={marketing} ticketRetentionAgreed={ticketRetentionAgreed} />
  }
  return (
    <WithdrawForm
      key={`${option.mode}-${option.notice.sha256}`}
      email={email}
      option={{ ...option, notice: option.notice }}
      texts={texts}
      ticketRetentionAgreed={ticketRetentionAgreed}
      onDone={onDone}
    />
  )
}

export function WithdrawView({ email, screen, texts }: WithdrawViewProps) {
  const router = useRouter()
  const [done, setDone] = useState<Done | null>(null)
  const [ticketChoice, setTicketChoice] = useState<'keep' | 'remove' | null>(null)
  const [canceling, setCanceling] = useState(false)

  const marketing = screen.kind === 'form' || screen.kind === 'open_request' ? screen.marketing : null

  const cancelRequest = async (requestId: string) => {
    setCanceling(true)
    try {
      const response = await fetch('/api/auth/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_request', requestId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '요청을 취소하지 못했습니다.')
      toast.success(data.message || texts?.requestCanceled || '탈퇴 요청을 취소했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '요청을 취소하지 못했습니다.')
    } finally {
      setCanceling(false)
    }
  }

  let body: React.ReactNode
  if (done) {
    body = done.kind === 'request_created' ? (
      <section className={cardClassName}>
        <p role="status" className="text-sm font-semibold text-[var(--studio-ink)] break-keep">{texts?.requestCreated}</p>
        <MarketingResultLine marketing={done.marketing} label={marketing?.item?.label ?? null} template={marketing?.resultTemplate ?? null} />
        <button type="button" onClick={() => router.refresh()} className={`mt-6 ${outlineButtonClassName}`}>확인</button>
      </section>
    ) : (
      <section className={cardClassName}>
        <h2 className="text-lg font-bold text-[var(--studio-ink)] break-keep">{texts?.completionTitle}</h2>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-[var(--studio-muted)] break-keep">
          {done.kind === 'anonymized' && done.kept.map((line) => <li key={line}>{line}</li>)}
          {texts?.completionDeleted && <li>{texts.completionDeleted}</li>}
        </ul>
        <MarketingResultLine marketing={done.marketing} label={marketing?.item?.label ?? null} template={marketing?.resultTemplate ?? null} />
        <button type="button" onClick={() => router.push('/')} className={`mt-6 ${primaryButtonClassName}`}>처음 화면으로</button>
      </section>
    )
  } else if (screen.kind === 'unavailable' || screen.kind === 'admin' || !texts) {
    body = (
      <section className={cardClassName}>
        <p className="text-sm text-[var(--studio-ink)] break-keep">
          {screen.kind === 'unavailable' || screen.kind === 'admin' ? screen.message : '탈퇴 안내를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
        </p>
      </section>
    )
  } else if (screen.kind === 'finish_delete') {
    body = <FinishDeleteForm email={email} texts={texts} onDone={setDone} />
  } else if (screen.kind === 'open_request') {
    body = (
      <section className={cardClassName}>
        <p className="text-sm font-semibold text-[var(--studio-ink)] break-keep">{texts.requestPending}</p>
        <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm text-[var(--studio-muted)]">
          <dt>접수 일시</dt>
          <dd>{formatKstDateTime(screen.request.receivedAt)}</dd>
          <dt>동의한 소멸</dt>
          <dd>{screen.request.expectedBalance.toLocaleString()} 크레딧</dd>
        </dl>
        {texts.requestCreated && <p className="mt-3 text-sm text-[var(--studio-muted)] break-keep">{texts.requestCreated}</p>}
        <button type="button" onClick={() => void cancelRequest(screen.request.id)} disabled={canceling} className={`mt-6 ${outlineButtonClassName}`}>
          {canceling && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          탈퇴 요청 취소하기
        </button>
        {texts.requestCanceled && <p className="mt-2 text-xs text-[var(--studio-muted)] break-keep">{texts.requestCanceled}</p>}
      </section>
    )
  } else if (screen.ticketChoice && screen.keep && screen.remove) {
    const option = ticketChoice === 'keep' ? screen.keep : ticketChoice === 'remove' ? screen.remove : null
    body = (
      <>
        <section className={cardClassName}>
          <h2 className="text-base font-bold text-[var(--studio-ink)] break-keep">{texts.ticketChoiceTitle}</h2>
          {texts.ticketChoicePurpose && <p className="mt-2 text-sm text-[var(--studio-muted)] break-keep">{texts.ticketChoicePurpose}</p>}
          <div className="mt-4 space-y-1" role="radiogroup">
            {([['keep', texts.ticketChoiceAgree], ['remove', texts.ticketChoiceDisagree]] as const).map(([value, label]) => (
              <label key={value} className="flex min-h-9 cursor-pointer items-center gap-3 text-sm text-[var(--studio-ink)] break-keep">
                <input
                  type="radio"
                  name="ticketRetention"
                  value={value}
                  checked={ticketChoice === value}
                  onChange={() => setTicketChoice(value)}
                  className="size-4 shrink-0 accent-[var(--studio-primary)]"
                />
                {label}
              </label>
            ))}
          </div>
        </section>
        {option && (
          <OptionPanel
            email={email}
            option={option}
            texts={texts}
            marketing={screen.marketing}
            ticketRetentionAgreed={ticketChoice === 'keep'}
            onDone={setDone}
          />
        )}
      </>
    )
  } else if (screen.single) {
    body = (
      <OptionPanel email={email} option={screen.single} texts={texts} marketing={screen.marketing} ticketRetentionAgreed={null} onDone={setDone} />
    )
  } else {
    body = null
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">회원 탈퇴</h1>
      {!done && screen.kind === 'form' && (
        <p className="mt-2 text-sm text-[var(--studio-muted)] break-keep">
          회원 탈퇴 전 아래 내용을 반드시 확인해주세요.
        </p>
      )}

      <div className="mt-6 max-w-2xl space-y-6">
        {body}

        {!done && (
          <section className={cardClassName}>
            <h2 className="text-lg font-bold text-[var(--studio-ink)] break-keep">
              탈퇴 대신 고려해보세요
            </h2>
            <div className="mt-3 space-y-2 text-sm text-[var(--studio-muted)] break-keep">
              <p>
                • 문제가 있으시다면 <span className="font-medium text-[var(--studio-primary)]">1:1 문의</span>를
                통해 도움을 받아보세요.
              </p>
              <p>• 잠시 서비스를 쉬고 싶다면 로그아웃 후 나중에 다시 이용하실 수 있습니다.</p>
              <p>
                • 비밀번호 변경이 필요하시다면{' '}
                <span className="font-medium text-[var(--studio-primary)]">내정보 관리</span>에서 변경
                가능합니다.
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
