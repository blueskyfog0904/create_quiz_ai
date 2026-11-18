'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface RevokeCreditButtonProps {
  sourceId: string
  // 이 지급 건의 남은 수량(회수할 수 있는 최대치)
  remaining: number
  sourceLabel: string
}

// 관리자 지급 건 하나에서 크레딧을 회수한다(남은 수량 안에서만, 사유 필수). 한도·작업 기록은 서버(DB)가 본다.
export function RevokeCreditButton({ sourceId, remaining, sourceLabel }: RevokeCreditButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // 응답 유실 뒤 다시 눌러도 한 번만 회수되도록 창을 열 때 만든 키를 창이 닫힐 때까지 쓴다.
  const [idempotencyKey, setIdempotencyKey] = useState('')

  const openDialog = () => {
    setAmount(String(remaining))
    setReason('')
    setConfirming(false)
    setIdempotencyKey(crypto.randomUUID())
    setOpen(true)
  }

  const parsedAmount = Number(amount.trim())

  const toConfirm = () => {
    if (!Number.isInteger(parsedAmount) || parsedAmount < 1) {
      toast.error('회수할 크레딧을 1 이상의 정수로 입력해 주세요.')
      return
    }
    if (parsedAmount > remaining) {
      toast.error(`이 지급 건에 남은 크레딧(${remaining.toLocaleString()})보다 많이 회수할 수 없습니다.`)
      return
    }
    if (!reason.trim()) {
      toast.error('회수 사유를 입력해 주세요.')
      return
    }
    if (reason.trim().length > 500) {
      toast.error('회수 사유는 500자 이내로 입력해 주세요.')
      return
    }
    setConfirming(true)
  }

  const submit = async () => {
    setIsSubmitting(true)
    try {
      const response = await fetch('/api/admin/users/credits/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, amount: parsedAmount, reason: reason.trim(), idempotencyKey }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '크레딧을 회수하지 못했습니다.')
      }
      if (result.alreadyRevoked) {
        toast.success('이미 처리된 회수입니다. 크레딧 내역을 확인해 주세요.')
      } else if (result.notified) {
        toast.success(`크레딧 ${parsedAmount.toLocaleString()}개를 회수했습니다. 회원에게 알림을 보냈습니다.`)
      } else {
        toast.warning(`크레딧 ${parsedAmount.toLocaleString()}개를 회수했지만 회원 알림을 보내지 못했습니다. 필요하면 회원에게 따로 안내해 주세요.`)
      }
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '크레딧을 회수하지 못했습니다.')
      // 실패 뒤에도 남은 수량이 최신이 되게 다시 읽는다(응답만 유실된 경우 이미 회수됐을 수 있다).
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={openDialog} aria-label={`${sourceLabel} 회수`}>회수</Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (isSubmitting) return
          setOpen(next)
          // 창을 닫으면 남은 수량을 다시 읽는다(다시 열 때 새 요청 키를 만들므로, 옛 수량으로 두 번 회수하지 않게).
          if (!next) router.refresh()
        }}
      >
        <DialogContent className="sm:max-w-[460px] max-md:max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>크레딧 회수</DialogTitle>
            <DialogDescription>
              {sourceLabel} 건에 남은 {remaining.toLocaleString()} 크레딧 안에서 회수합니다. 이미 사용한 크레딧은 회수되지 않습니다.
            </DialogDescription>
          </DialogHeader>

          {confirming ? (
            <div className="space-y-2 rounded-lg bg-gray-50 p-4 text-sm">
              <p className="font-semibold text-gray-900">회수 내용을 확인해 주세요</p>
              <p>회수할 크레딧: <strong className="text-red-700">-{parsedAmount.toLocaleString()}</strong></p>
              <p className="break-words">사유: {reason.trim()}</p>
              <p className="text-xs text-gray-500">회수하면 되돌릴 수 없고, 회원에게 사유와 함께 알림이 갑니다.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`revoke-amount-${sourceId}`}>회수할 크레딧</Label>
                <Input
                  id={`revoke-amount-${sourceId}`}
                  type="number"
                  min={1}
                  max={remaining}
                  step={1}
                  inputMode="numeric"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`revoke-reason-${sourceId}`}>회수 사유 <span className="text-red-500">*</span></Label>
                <Textarea
                  id={`revoke-reason-${sourceId}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="예: 다른 회원에게 잘못 지급"
                  className="h-20"
                />
                <p className="text-xs text-gray-500">사유는 회원 알림에 함께 보입니다.</p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {confirming ? (
              <>
                <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={isSubmitting}>이전</Button>
                <Button type="button" variant="destructive" onClick={() => void submit()} disabled={isSubmitting}>
                  {isSubmitting ? '회수 중…' : '회수 확정'}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>취소</Button>
                <Button type="button" onClick={toConfirm}>다음</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
