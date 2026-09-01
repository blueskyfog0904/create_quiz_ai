'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { StudioContainer } from '@/components/design-system/studio-container'
import { createClient } from '@/lib/supabase/client'

const controlClassName =
  'min-h-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

const AGREEMENT_ITEMS = [
  { key: 'dataLoss', label: '위의 모든 데이터가 영구적으로 삭제된다는 것을 이해합니다.' },
  { key: 'noRecovery', label: '탈퇴 후 데이터 복구가 불가능하다는 것을 이해합니다.' },
  { key: 'finalConfirm', label: '회원 탈퇴를 최종적으로 확인하며, 모든 약관에 동의합니다.' },
] as const

interface WithdrawViewProps {
  email: string
}

export function WithdrawView({ email }: WithdrawViewProps) {
  const router = useRouter()
  const [confirmEmail, setConfirmEmail] = useState('')
  const [agreements, setAgreements] = useState({
    dataLoss: false,
    noRecovery: false,
    finalConfirm: false,
  })
  const [isDeleting, setIsDeleting] = useState(false)

  const allAgreed = agreements.dataLoss && agreements.noRecovery && agreements.finalConfirm
  const emailMatches = confirmEmail === email

  const handleWithdraw = async () => {
    if (!allAgreed || !emailMatches) {
      toast.error('모든 항목에 동의하고 이메일을 정확히 입력해주세요.')
      return
    }

    if (!confirm('정말로 회원 탈퇴를 진행하시겠습니까? 이 작업은 취소할 수 없습니다.')) {
      return
    }

    setIsDeleting(true)

    try {
      const response = await fetch('/api/auth/withdraw', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '회원 탈퇴에 실패했습니다.')
      }

      // Sign out after deletion
      const supabase = createClient()
      await supabase.auth.signOut()

      toast.success('회원 탈퇴가 완료되었습니다. 이용해 주셔서 감사합니다.')
      router.push('/')
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <StudioContainer className="py-8 sm:py-10">
      <Link
        href="/mypage"
        className="inline-flex min-h-9 items-center rounded-[var(--studio-radius-control)] text-sm font-medium text-[var(--studio-muted)] outline-none transition-colors hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
      >
        ← 마이페이지
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">회원 탈퇴</h1>
      <p className="mt-2 text-sm text-[var(--studio-muted)] break-keep">
        회원 탈퇴 전 아래 내용을 반드시 확인해주세요.
      </p>

      <div className="mt-6 max-w-2xl space-y-6">
        <section className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-7">
          <div className="rounded-[var(--studio-radius-control)] bg-red-50 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-red-800 break-keep">
              <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
              회원 탈퇴 시 다음 내용이 삭제됩니다:
            </h2>
            <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-red-700 break-keep">
              <li>생성한 모든 문제 및 문제지</li>
              <li>저장한 문제 은행 데이터</li>
              <li>결제 및 크레딧 내역</li>
              <li>모든 활동 기록 및 통계</li>
              <li>계정 정보 및 프로필</li>
            </ul>
            <p className="mt-3 text-sm font-medium text-red-800 break-keep">
              ⚠️ 삭제된 데이터는 복구할 수 없습니다.
            </p>
          </div>

          <div className="mt-6 space-y-1">
            {AGREEMENT_ITEMS.map((item) => (
              <label
                key={item.key}
                htmlFor={item.key}
                className="flex min-h-9 cursor-pointer items-center gap-3 rounded-[var(--studio-radius-control)] text-sm leading-relaxed text-[var(--studio-ink)] break-keep"
              >
                <input
                  id={item.key}
                  type="checkbox"
                  checked={agreements[item.key]}
                  onChange={(event) =>
                    setAgreements((prev) => ({ ...prev, [item.key]: event.target.checked }))
                  }
                  className="size-4 shrink-0 accent-[var(--studio-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                />
                {item.label}
              </label>
            ))}
          </div>

          <div className="mt-6">
            <label
              htmlFor="confirmEmail"
              className="block text-sm font-medium text-[var(--studio-ink)] break-keep"
            >
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
            onClick={handleWithdraw}
            disabled={!allAgreed || !emailMatches || isDeleting}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--studio-radius-control)] border border-red-500 bg-[var(--studio-surface)] px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500 hover:text-white disabled:opacity-50 disabled:hover:bg-[var(--studio-surface)] disabled:hover:text-red-600 outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            {isDeleting && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {isDeleting ? '탈퇴 처리 중…' : '회원 탈퇴하기'}
          </button>
        </section>

        <section className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-7">
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
      </div>
    </StudioContainer>
  )
}
