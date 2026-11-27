'use client'

import * as React from 'react'

import { StudioAlertDialog } from '@/components/design-system/studio-dialog'

import { createAdminConfirmQueue, type AdminConfirmRequest } from './admin-confirm-queue'

export interface AdminConfirmImpact {
  label: string
  value: React.ReactNode
  // 금액처럼 굵게
  emphasis?: boolean
}

export interface AdminConfirmOptions {
  title: string
  description?: React.ReactNode
  // 영향 목록. 있으면 폭 480px·본문 왼쪽 정렬.
  impacts?: AdminConfirmImpact[]
  confirmLabel?: string
  cancelLabel?: string
  // 위험 동작(삭제·회수·판매 중지): 확정 버튼이 adminDanger
  danger?: boolean
}

export interface AdminConfirmReasonOptions extends AdminConfirmOptions {
  reasonLabel: string
  reasonPlaceholder?: string
  // 비어 있는 동안 확정 버튼을 막는다(기본 true)
  reasonRequired?: boolean
}

interface AdminConfirmDialogProps extends AdminConfirmOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  reason?: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }
  // 창 안에서 처리를 기다리는 화면용(확정 뒤 창을 열어 둔 채 처리 중 표시). 처리 중에는 닫힘·확정을 막는다.
  pending?: boolean
}

// 관리자 확인 창(20번 5-3) = StudioAlertDialog 를 넓힌 것. 첫 초점 [취소], 높이 제한, 위험 확정은 adminDanger.
export function AdminConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  impacts,
  confirmLabel = '확인',
  cancelLabel = '취소',
  danger = false,
  reason,
  pending = false,
}: AdminConfirmDialogProps) {
  return (
    <StudioAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      impacts={impacts}
      reason={reason}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      onConfirm={onConfirm}
      destructive={danger}
      pending={pending}
      destructiveVariant="adminDanger"
      limitHeight
      focusCancelOnOpen
    />
  )
}

// 쓰는 법: const { ask, dialog } = useAdminConfirm(); … const ok = await ask({...}); 그리고 {dialog} 를 그린다.
// (가) 먼저 묻기: 확인 전에는 요청을 보내지 않는다.
// (나) 응답 뒤 묻기: 첫 요청 → 409 부족분 → 같은 try 안에서 잠금을 쥔 채 await ask() → 확인이면 다시 요청.
// 약속 처리(확정·취소·연속 ask·화면 사라짐)는 admin-confirm-queue.ts 가 맡는다.
export function useAdminConfirm() {
  const [request, setRequest] = React.useState<AdminConfirmRequest<AdminConfirmOptions, AdminConfirmReasonOptions> | null>(null)
  const [reasonText, setReasonText] = React.useState('')
  const [queue] = React.useState(() =>
    createAdminConfirmQueue<AdminConfirmOptions, AdminConfirmReasonOptions>((next) => {
      setReasonText('')
      setRequest(next)
    })
  )

  // 화면이 사라지면 열린 확인은 취소로 끝낸다.
  React.useEffect(() => () => queue.settle(false), [queue])

  const dialog = request ? (
    <AdminConfirmDialog
      {...request.options}
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) queue.settle(false)
      }}
      onConfirm={() => queue.settle(true, reasonText)}
      reason={
        request.type === 'reason'
          ? {
              label: request.options.reasonLabel,
              placeholder: request.options.reasonPlaceholder,
              required: request.options.reasonRequired ?? true,
              value: reasonText,
              onChange: setReasonText,
            }
          : undefined
      }
    />
  ) : null

  return { ask: queue.ask, askReason: queue.askReason, dialog }
}
