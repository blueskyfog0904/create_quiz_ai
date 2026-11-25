'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { StudioAlertDialog } from '@/components/design-system'
import { ConsentChecklist } from '@/components/auth/consent-checklist'
import { normalizeConsentNextPath } from '@/lib/auth-paths'
import {
  buildConsentSubmission,
  clearKakaoConsentDraft,
  findMissingRequiredItems,
  formatOptionalResult,
  getConsentErrorMessage,
  type ConsentItem,
  type ConsentRecordResult,
  type SignupConsentTexts,
} from '@/lib/signup-consent'
import { submitConsentAction } from './actions'

const MEMBER_LINKS = [
  { href: '/mypage/consents', label: '선택 동의 관리' },
  { href: '/library', label: '자료 보관함(구매한 자료)' },
  { href: '/mypage/credits', label: '크레딧 관리·환불' },
  { href: '/mypage/payments', label: '결제 내역' },
  { href: '/mypage/support', label: '1:1 문의' },
  { href: '/mypage/withdraw', label: '탈퇴하기' },
] as const

async function logoutThisDevice() {
  const response = await fetch('/api/auth/consent-logout', { method: 'POST' })
  if (!response.ok) {
    throw new Error('logout_failed')
  }
}

function ConsentShell({ title, description, children, footer }: {
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex min-h-[calc(100vh-150px)] flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <Card className="w-full max-w-lg border-0 bg-transparent shadow-none ring-0">
        <CardHeader className="space-y-2">
          <CardTitle className="text-center text-2xl font-bold tracking-tight">{title}</CardTitle>
          {description ? <CardDescription className="whitespace-pre-line break-keep text-center text-gray-600">{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent className="grid gap-4">{children}</CardContent> : null}
        {footer ? <CardFooter className="flex flex-col gap-2">{footer}</CardFooter> : null}
      </Card>
    </div>
  )
}

// 판정·항목을 불러오지 못했을 때: 이동하지 않고(왕복 방지) 다시 시도·로그아웃만 보여 준다.
export function ConsentUnavailable({ kind }: { kind: 'retry' | 'profile_missing' | 'policy_unavailable' }) {
  const [pending, setPending] = useState(false)
  const message = kind === 'profile_missing'
    ? getConsentErrorMessage('CONSENT_PROFILE_MISSING')
    : kind === 'policy_unavailable'
      ? getConsentErrorMessage('CONSENT_POLICY_UNAVAILABLE')
      : '약관 동의 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'

  return (
    <ConsentShell
      title="약관 동의"
      description={message}
      footer={(
        <>
          {kind !== 'profile_missing' ? (
            <Button variant="brand" type="button" className="h-11 w-full" onClick={() => window.location.reload()}>
              다시 시도
            </Button>
          ) : null}
          <Button
            variant="brandOutline"
            type="button"
            className="h-11 w-full"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              try {
                await logoutThisDevice()
                window.location.replace('/?logout=success')
              } catch {
                setPending(false)
                toast.error('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.')
              }
            }}
          >
            로그아웃
          </Button>
        </>
      )}
    />
  )
}

export function ConsentClient({
  items,
  texts,
  privacyPolicyHref,
  senderName,
  next,
  revised,
  customerCenter,
  upcomingNotice,
}: {
  items: ConsentItem[]
  texts: SignupConsentTexts
  privacyPolicyHref: string
  senderName: string
  next: string
  revised: boolean
  customerCenter: string
  upcomingNotice?: ReactNode
}) {
  const router = useRouter()
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [highlightMissing, setHighlightMissing] = useState(false)
  const [results, setResults] = useState<string[] | null>(null)
  const [declineOpen, setDeclineOpen] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [isPending, startTransition] = useTransition()
  const target = normalizeConsentNextPath(next)

  useEffect(() => {
    // 카카오 가입 전에 받아 둔 동의값은 여기서 쓰지 않는다.
    clearKakaoConsentDraft()
  }, [])

  const submit = () => {
    if (findMissingRequiredItems(items, checked).length > 0) {
      setHighlightMissing(true)
      toast.error(getConsentErrorMessage('CONSENT_REQUIRED_MISSING'))
      return
    }
    const submission = buildConsentSubmission(items, checked)
    startTransition(async () => {
      const outcome = await submitConsentAction(JSON.stringify(submission))
      if (!outcome.ok) {
        if (outcome.code === 'CONSENT_KAKAO_SIGNUP_INCOMPLETE') {
          window.location.replace(`/signup?${new URLSearchParams({ provider: 'kakao', signup: '1', next: target }).toString()}`)
          return
        }
        if (outcome.code === 'CONSENT_AUTH_REQUIRED') {
          window.location.replace(`/login?${new URLSearchParams({ next: `/consent?${new URLSearchParams({ next: target })}` }).toString()}`)
          return
        }
        toast.error(getConsentErrorMessage(outcome.code))
        if (outcome.code === 'CONSENT_ITEM_CHANGED' || outcome.code === 'CONSENT_REQUIRED_MISSING') {
          // 항목이 바뀌었다: 체크를 비우고 최신 항목으로 다시 그린다(보지 못한 새 버전에 이전 체크가 붙지 않게).
          setChecked({})
          setHighlightMissing(false)
          router.refresh()
        }
        return
      }
      const records: ConsentRecordResult[] = outcome.results
      const lines = items
        .filter((item) => !item.required)
        .map((item) => {
          const record = records.find((candidate) => candidate.item_id === item.id)
          return record
            ? formatOptionalResult(texts.optionalResultTemplate, {
                sender: senderName,
                itemLabel: item.label,
                agreed: record.agreed,
                processedAt: record.created_at,
              })
            : null
        })
        .filter((line): line is string => Boolean(line))
      if (lines.length === 0) {
        window.location.assign(target)
        return
      }
      setResults(lines)
    })
  }

  const decline = async () => {
    setDeclining(true)
    try {
      await logoutThisDevice()
      window.location.replace('/?logout=success')
    } catch {
      setDeclining(false)
      toast.error('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  if (results) {
    return (
      <ConsentShell
        title="동의가 반영되었습니다"
        footer={(
          <Button variant="brand" type="button" className="h-11 w-full" onClick={() => window.location.assign(target)}>
            계속
          </Button>
        )}
      >
        <div className="rounded-lg border border-gray-100 bg-white p-4 text-sm leading-6 text-gray-700">
          {results.map((line) => <p key={line}>{line}</p>)}
        </div>
      </ConsentShell>
    )
  }

  return (
    <ConsentShell
      title={texts.consentTitle}
      description={revised ? texts.consentRevisedIntro : texts.consentFirstIntro}
      footer={(
        <>
          <Button variant="brand" type="button" className="h-11 w-full" disabled={isPending} onClick={submit}>
            {isPending ? '처리 중...' : '동의하고 계속'}
          </Button>
          <Button variant="ghost" type="button" className="h-10 w-full text-sm text-gray-500" disabled={isPending} onClick={() => setDeclineOpen(true)}>
            지금은 동의하지 않고 로그아웃
          </Button>
          <nav aria-label="회원 메뉴" className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-gray-500">
            {MEMBER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="underline underline-offset-2">{link.label}</Link>
            ))}
          </nav>
          {customerCenter ? <p className="text-center text-xs text-gray-500">고객센터 {customerCenter}</p> : null}
        </>
      )}
    >
      {/* 동의 목록 위: 변경 예정 약관 한 줄 안내(15번 6-2) */}
      {upcomingNotice}
      <ConsentChecklist
        items={items}
        checked={checked}
        onChange={setChecked}
        highlightMissing={highlightMissing}
        privacyPolicyHref={privacyPolicyHref}
        optionalHint={texts.optionalNotRequiredHint}
        showRevisionNotes={revised}
      />
      <StudioAlertDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        title="동의하지 않고 로그아웃할까요?"
        description={texts.declineConfirm}
        confirmLabel="로그아웃"
        cancelLabel="돌아가기"
        onConfirm={decline}
        pending={declining}
      />
    </ConsentShell>
  )
}
