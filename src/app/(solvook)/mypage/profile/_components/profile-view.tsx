'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { StudioContainer } from '@/components/design-system'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

interface ProfileViewProps {
  email: string
  name: string | null
  phone: string | null
  createdAt: string | null
}

const controlClassName =
  'w-full min-h-11 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

const cardClassName =
  'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-7'

const readOnlyBandClassName =
  'flex min-h-11 items-center rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-3'

const fieldLabelClassName = 'text-[var(--studio-muted)]'

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}.${month}.${day}`
}

function formatPhoneNumber(value: string) {
  const cleaned = value.replace(/\D/g, '')

  if (cleaned.length <= 3) {
    return cleaned
  } else if (cleaned.length <= 7) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`
  } else {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7, 11)}`
  }
}

export function ProfileView({ email, name, phone: initialPhone, createdAt }: ProfileViewProps) {
  const router = useRouter()

  // 휴대폰 번호 수정
  const [isEditingPhone, setIsEditingPhone] = useState(false)
  const [phone, setPhone] = useState(initialPhone || '')
  const [isSavingPhone, setIsSavingPhone] = useState(false)

  // 비밀번호 변경 (2단계: 기존 비밀번호 검증 → 새 비밀번호 설정)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [isCurrentPasswordVerified, setIsCurrentPasswordVerified] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneNumber(e.target.value))
  }

  const handlePhoneSave = async () => {
    setIsSavingPhone(true)

    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'update_phone',
          phone: phone?.trim() || '',
        }),
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '프로필 업데이트에 실패했습니다.')
      }

      toast.success('프로필 정보가 성공적으로 업데이트되었습니다.')
      setIsEditingPhone(false)
      router.refresh()
    } catch (error: unknown) {
      console.error('Profile update error:', error)
      const message = error instanceof Error ? error.message : '프로필 업데이트에 실패했습니다.'
      toast.error(message)
    } finally {
      setIsSavingPhone(false)
    }
  }

  const handlePhoneCancel = () => {
    setPhone(initialPhone || '')
    setIsEditingPhone(false)
  }

  const resetPasswordForm = () => {
    setIsChangingPassword(false)
    setIsCurrentPasswordVerified(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const handleVerifyCurrentPassword = async () => {
    if (!currentPassword.trim()) {
      toast.error('기존 비밀번호를 입력해주세요.')
      return
    }

    setIsSubmitting(true)
    const supabase = createClient()

    try {
      if (!email) {
        throw new Error('계정 이메일을 확인할 수 없습니다.')
      }

      const { error: currentPasswordError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      })

      if (currentPasswordError) {
        throw new Error('기존 비밀번호가 올바르지 않습니다.')
      }

      setIsCurrentPasswordVerified(true)
      setCurrentPassword('')
      toast.success('기존 비밀번호가 확인되었습니다. 새 비밀번호를 입력해주세요.')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '기존 비밀번호 확인에 실패했습니다.'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!isCurrentPasswordVerified) {
      toast.error('먼저 기존 비밀번호를 확인해주세요.')
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error('새 비밀번호가 일치하지 않습니다.')
      return
    }

    if (newPassword.length < 6) {
      toast.error('비밀번호는 최소 6자 이상이어야 합니다.')
      return
    }

    setIsSubmitting(true)
    const supabase = createClient()

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) {
        throw error
      }

      toast.success('비밀번호가 성공적으로 변경되었습니다.')
      resetPasswordForm()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '비밀번호 변경에 실패했습니다.'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
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
      <h1 className="mt-2 break-keep text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">
        내정보 관리
      </h1>
      <p className="mt-2 break-keep text-sm text-[var(--studio-muted)]">
        계정 기본 정보를 확인하고 휴대폰 번호와 비밀번호를 관리할 수 있어요.
      </p>

      <div className="mt-6 space-y-6">
        {/* 내정보 */}
        <section className={cardClassName} aria-busy={isSavingPhone}>
          <h2 className="break-keep text-lg font-bold text-[var(--studio-ink)]">내정보</h2>
          <p className="mt-1 break-keep text-sm text-[var(--studio-muted)]">
            계정 기본 정보입니다.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className={fieldLabelClassName}>이름</Label>
              <div className={readOnlyBandClassName}>
                <span className="break-keep text-sm font-medium text-[var(--studio-ink)]">
                  {name || '미설정'}
                </span>
                <span className="ml-2 text-xs text-[var(--studio-muted)]">(변경 불가)</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className={fieldLabelClassName}>이메일</Label>
              <div className={readOnlyBandClassName}>
                <span className="text-sm font-medium text-[var(--studio-ink)]">
                  {email || '미설정'}
                </span>
                <span className="ml-2 text-xs text-[var(--studio-muted)]">(변경 불가)</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label className={fieldLabelClassName} htmlFor="phone">
                휴대폰 번호
              </Label>
              {isEditingPhone ? (
                <input
                  id="phone"
                  className={controlClassName}
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="010-1234-5678"
                  maxLength={13}
                  inputMode="numeric"
                />
              ) : (
                <div className={readOnlyBandClassName}>
                  <span className="text-sm font-medium text-[var(--studio-ink)]">
                    {initialPhone || '미설정'}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className={fieldLabelClassName}>가입일</Label>
              <div className={readOnlyBandClassName}>
                <span className="text-sm font-medium text-[var(--studio-ink)]">
                  {createdAt ? formatDate(createdAt) : '알 수 없음'}
                </span>
              </div>
            </div>
          </div>

          {!isEditingPhone ? (
            <Button
              type="button"
              variant="brand"
              className="mt-5 min-h-11"
              onClick={() => setIsEditingPhone(true)}
            >
              휴대폰 번호 수정
            </Button>
          ) : (
            <div className="mt-5 flex gap-2">
              <Button
                type="button"
                variant="brand"
                className="min-h-11"
                onClick={handlePhoneSave}
                disabled={isSavingPhone}
              >
                {isSavingPhone ? '저장 중…' : '저장하기'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={handlePhoneCancel}
                disabled={isSavingPhone}
              >
                취소
              </Button>
            </div>
          )}
        </section>

        {/* 비밀번호 변경 */}
        <section className={cardClassName} aria-busy={isSubmitting}>
          <h2 className="break-keep text-lg font-bold text-[var(--studio-ink)]">비밀번호 변경</h2>
          <p className="mt-1 break-keep text-sm text-[var(--studio-muted)]">
            계정 보안을 위해 주기적으로 비밀번호를 변경해주세요.
          </p>

          <div className="mt-5">
            {!isChangingPassword ? (
              <Button
                type="button"
                variant="brand"
                className="min-h-11"
                onClick={() => setIsChangingPassword(true)}
              >
                비밀번호 변경하기
              </Button>
            ) : (
              <div className="max-w-md space-y-4">
                {!isCurrentPasswordVerified ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="currentPassword">기존 비밀번호</Label>
                      <input
                        id="currentPassword"
                        className={controlClassName}
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="기존 비밀번호 입력"
                        required
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="brand"
                        className="min-h-11"
                        onClick={handleVerifyCurrentPassword}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? '확인 중…' : '기존 비밀번호 확인'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        onClick={resetPasswordForm}
                      >
                        취소
                      </Button>
                    </div>
                  </>
                ) : (
                  <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div className="break-keep rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-3 py-2 text-sm text-[var(--studio-ink)]">
                      기존 비밀번호 확인이 완료되었습니다. 새 비밀번호를 입력해주세요.
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="newPassword">새 비밀번호</Label>
                      <input
                        id="newPassword"
                        className={controlClassName}
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="새 비밀번호 입력 (최소 6자)"
                        required
                        minLength={6}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
                      <input
                        id="confirmPassword"
                        className={controlClassName}
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="새 비밀번호 확인"
                        required
                      />
                      {confirmPassword && newPassword !== confirmPassword && (
                        <p className="break-keep text-sm text-red-500">
                          비밀번호가 일치하지 않습니다.
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="brand"
                        className="min-h-11"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? '변경 중…' : '변경하기'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        onClick={resetPasswordForm}
                      >
                        취소
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </StudioContainer>
  )
}
