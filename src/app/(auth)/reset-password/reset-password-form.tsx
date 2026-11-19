'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { updateRecoveredPassword } from '../../auth/password-reset-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PASSWORD_MIN_LENGTH, validateNewPassword } from '@/lib/password-reset'

export function ResetPasswordForm() {
  const [isLoading, setIsLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  async function handleUpdate(formData: FormData) {
    const passwordError = validateNewPassword(password, confirmPassword)
    if (passwordError) {
      toast.error(passwordError)
      return
    }

    setIsLoading(true)
    try {
      // 성공하면 서버가 로그인 화면으로 보낸다.
      const result = await updateRecoveredPassword(formData)
      if (result?.error) {
        toast.error(result.error)
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form action={handleUpdate}>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="password">새 비밀번호</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
          />
          <p className="text-xs text-gray-500">최소 {PASSWORD_MIN_LENGTH}자 이상</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="h-11"
          />
          {confirmPassword.length > 0 && (
            <p className={`text-xs mt-1 ${password === confirmPassword ? 'text-green-600' : 'text-red-500'}`}>
              {password === confirmPassword
                ? '비밀번호가 일치합니다.'
                : '비밀번호가 일치하지 않습니다.'}
            </p>
          )}
        </div>
        <p className="text-xs text-gray-500 break-keep">
          비밀번호를 바꾸면 모든 기기에서 로그아웃됩니다. 새 비밀번호로 다시 로그인해 주세요.
        </p>
        <Button variant="brand" className="w-full h-11 mt-2 text-md font-medium" type="submit" disabled={isLoading || password !== confirmPassword}>
          {isLoading ? '변경 중...' : '비밀번호 변경'}
        </Button>
      </div>
    </form>
  )
}
