'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface CreditGrantLimitsCardProps {
  limits: { perGrant: number; perDay: number } | null
  canEdit: boolean
}

const format = (value: number) => value.toLocaleString('ko-KR')

// 직원(staff) 크레딧 수동 지급의 기본 한도. 대표는 한도가 없고, 계정별 한도(권한 부여 화면)가 있으면 그 값이 우선한다.
export function CreditGrantLimitsCard({ limits, canEdit }: CreditGrantLimitsCardProps) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [perGrant, setPerGrant] = useState('')
  const [perDay, setPerDay] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const startEdit = () => {
    setPerGrant(limits ? String(limits.perGrant) : '')
    setPerDay(limits ? String(limits.perDay) : '')
    setIsEditing(true)
  }

  const save = async () => {
    const nextPerGrant = Number(perGrant.trim())
    const nextPerDay = Number(perDay.trim())
    if (!Number.isInteger(nextPerGrant) || nextPerGrant < 1 || !Number.isInteger(nextPerDay) || nextPerDay < 1) {
      toast.error('한도는 1 이상의 정수로 입력해 주세요.')
      return
    }
    if (nextPerGrant > nextPerDay) {
      toast.error('1회 한도는 하루 한도보다 클 수 없습니다.')
      return
    }
    setIsSaving(true)
    try {
      const response = await fetch('/api/admin/users/credits/limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perGrant: nextPerGrant, perDay: nextPerDay }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '기본 한도를 저장하지 못했습니다.')
      }
      toast.success('기본 한도를 저장했습니다. 다음 지급부터 적용됩니다.')
      setIsEditing(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '기본 한도를 저장하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">직원 크레딧 지급 기본 한도</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isEditing ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">1회 한도 (크레딧)</span>
              <Input type="number" min={1} step={1} inputMode="numeric" className="w-36" value={perGrant} onChange={(event) => setPerGrant(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">하루 한도 (크레딧)</span>
              <Input type="number" min={1} step={1} inputMode="numeric" className="w-36" value={perDay} onChange={(event) => setPerDay(event.target.value)} />
            </label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setIsEditing(false)} disabled={isSaving}>취소</Button>
              <Button type="button" onClick={() => void save()} disabled={isSaving}>{isSaving ? '저장 중…' : '저장'}</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {limits ? (
              <>
                <span>1회 <strong>{format(limits.perGrant)}</strong> 크레딧</span>
                <span>하루 <strong>{format(limits.perDay)}</strong> 크레딧</span>
              </>
            ) : (
              <span className="text-red-600">기본 한도 설정이 없습니다. 직원 계정의 지급이 거부됩니다.</span>
            )}
            {canEdit && (
              <Button type="button" size="sm" variant="adminAction" onClick={startEdit}>변경</Button>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          하루는 한국 시간 0시~24시, 직원 한 명이 그날 지급한 합계입니다. 대표 관리자는 한도가 없고,
          관리자 계정 권한 화면에서 직원별 한도를 따로 정하면 그 값이 우선합니다. 변경 내역은 작업 기록에 남습니다.
        </p>
      </CardContent>
    </Card>
  )
}
