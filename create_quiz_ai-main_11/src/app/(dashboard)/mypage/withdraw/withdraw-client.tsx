'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface WithdrawClientProps {
  email: string
}

export function WithdrawClient({ email }: WithdrawClientProps) {
  const router = useRouter()
  const [confirmEmail, setConfirmEmail] = useState('')
  const [agreements, setAgreements] = useState({
    dataLoss: false,
    noRecovery: false,
    finalConfirm: false
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
        body: JSON.stringify({ confirmEmail })
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
    <div className="space-y-6">
      <Card className="border-red-200">
        <CardHeader>
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            <CardTitle>회원 탈퇴</CardTitle>
          </div>
          <CardDescription>
            회원 탈퇴 전 아래 내용을 반드시 확인해주세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Warning Messages */}
          <div className="p-4 bg-red-50 rounded-lg border border-red-200 space-y-3">
            <h3 className="font-semibold text-red-800">회원 탈퇴 시 다음 내용이 삭제됩니다:</h3>
            <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
              <li>생성한 모든 문제 및 문제지</li>
              <li>저장한 문제 은행 데이터</li>
              <li>결제 및 크레딧 내역</li>
              <li>모든 활동 기록 및 통계</li>
              <li>계정 정보 및 프로필</li>
            </ul>
            <p className="text-sm font-medium text-red-800">
              ⚠️ 삭제된 데이터는 복구할 수 없습니다.
            </p>
          </div>

          {/* Agreement Checkboxes */}
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="dataLoss"
                checked={agreements.dataLoss}
                onCheckedChange={(checked) => 
                  setAgreements(prev => ({ ...prev, dataLoss: checked as boolean }))
                }
              />
              <Label htmlFor="dataLoss" className="text-sm leading-relaxed cursor-pointer">
                위의 모든 데이터가 영구적으로 삭제된다는 것을 이해합니다.
              </Label>
            </div>
            
            <div className="flex items-start space-x-3">
              <Checkbox
                id="noRecovery"
                checked={agreements.noRecovery}
                onCheckedChange={(checked) => 
                  setAgreements(prev => ({ ...prev, noRecovery: checked as boolean }))
                }
              />
              <Label htmlFor="noRecovery" className="text-sm leading-relaxed cursor-pointer">
                탈퇴 후 데이터 복구가 불가능하다는 것을 이해합니다.
              </Label>
            </div>
            
            <div className="flex items-start space-x-3">
              <Checkbox
                id="finalConfirm"
                checked={agreements.finalConfirm}
                onCheckedChange={(checked) => 
                  setAgreements(prev => ({ ...prev, finalConfirm: checked as boolean }))
                }
              />
              <Label htmlFor="finalConfirm" className="text-sm leading-relaxed cursor-pointer">
                회원 탈퇴를 최종적으로 확인하며, 모든 약관에 동의합니다.
              </Label>
            </div>
          </div>

          {/* Email Confirmation */}
          <div className="space-y-2">
            <Label htmlFor="confirmEmail">
              본인 확인을 위해 이메일 주소를 입력해주세요
            </Label>
            <Input
              id="confirmEmail"
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={email}
            />
            {confirmEmail && !emailMatches && (
              <p className="text-sm text-red-500">이메일 주소가 일치하지 않습니다.</p>
            )}
          </div>

          {/* Submit Button */}
          <Button
            variant="destructive"
            onClick={handleWithdraw}
            disabled={!allAgreed || !emailMatches || isDeleting}
            className="w-full"
          >
            {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            회원 탈퇴하기
          </Button>
        </CardContent>
      </Card>

      {/* Alternative Options */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">탈퇴 대신 고려해보세요</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <p>• 문제가 있으시다면 <span className="text-primary">1:1 문의</span>를 통해 도움을 받아보세요.</p>
          <p>• 잠시 서비스를 쉬고 싶다면 로그아웃 후 나중에 다시 이용하실 수 있습니다.</p>
          <p>• 비밀번호 변경이 필요하시다면 <span className="text-primary">내정보 관리</span>에서 변경 가능합니다.</p>
        </CardContent>
      </Card>
    </div>
  )
}


