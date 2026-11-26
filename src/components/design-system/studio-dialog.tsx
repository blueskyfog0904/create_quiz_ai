'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { StudioDialogContent } from './studio-portal-surface'

// 회원 화면 팝업 공통 모양(솔북 기준): 흰 판·둥근 모서리, 아이콘 없이 가운데 정렬 제목·본문, 아래 버튼은 같은 너비.
// 목록·표 같은 본문 내용은 각 팝업에서 왼쪽 정렬로 둔다.
function StudioDialogPanel({
  className,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof StudioDialogContent>) {
  return (
    <StudioDialogContent
      showCloseButton={showCloseButton}
      className={cn(
        'max-w-[calc(100%-2rem)] gap-6 rounded-2xl border-0 p-6 shadow-none sm:max-w-[400px]',
        // 가운데 정렬 제목이 닫기(X) 버튼 쪽으로 치우치지 않게 양옆 여백을 같게 둔다.
        showCloseButton ? '[&_[data-slot=dialog-header]]:px-16' : '[&_[data-slot=dialog-header]]:pr-0',
        className
      )}
      {...props}
    />
  )
}

function StudioDialogHeader({ className, ...props }: React.ComponentProps<typeof DialogHeader>) {
  return <DialogHeader className={cn('gap-2 text-center sm:text-center', className)} {...props} />
}

function StudioDialogTitle({ className, ...props }: React.ComponentProps<typeof DialogTitle>) {
  return (
    <DialogTitle
      className={cn('break-keep text-lg font-bold leading-snug text-[var(--studio-ink)]', className)}
      {...props}
    />
  )
}

function StudioDialogDescription({ className, ...props }: React.ComponentProps<typeof DialogDescription>) {
  return (
    <DialogDescription
      className={cn('whitespace-pre-line break-keep text-sm leading-6 text-[var(--studio-text)]', className)}
      {...props}
    />
  )
}

// 버튼은 DOM 순서대로(취소 → 확정) 놓는다. PC는 한 줄에 같은 너비, 모바일은 위아래.
function StudioDialogFooter({ className, ...props }: React.ComponentProps<typeof DialogFooter>) {
  return (
    <DialogFooter
      className={cn('flex-col gap-2 sm:flex-row sm:justify-stretch [&>*]:min-h-12 sm:[&>*]:flex-1', className)}
      {...props}
    />
  )
}

interface StudioAlertDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  onConfirm: () => void
  // 있으면 취소 버튼을 함께 보인다(확인창). 없으면 확인 버튼 하나(알림창).
  cancelLabel?: string
  destructive?: boolean
  pending?: boolean
  // 아래는 관리자 확인 창(AdminConfirmDialog)이 쓰는 선택 속성. 회원 화면은 주지 않으므로 모양·동작이 그대로다.
  // 위험 확정 버튼 변형. 주지 않으면 지금처럼 destructive.
  destructiveVariant?: 'destructive' | 'adminDanger'
  // 영향 목록(예: 회수 크레딧·환불 금액). 있으면 폭 480px·본문 왼쪽 정렬. emphasis 는 금액처럼 굵게.
  impacts?: StudioAlertDialogImpact[]
  // 사유 칸. required 이면 비어 있는 동안 확정 버튼을 막는다.
  reason?: StudioAlertDialogReason
  // 높이 제한(작은 화면에서 창이 넘치지 않게 안에서 스크롤).
  limitHeight?: boolean
  // 열릴 때 첫 초점을 [취소]에 둔다.
  focusCancelOnOpen?: boolean
}

interface StudioAlertDialogImpact {
  label: string
  value: React.ReactNode
  emphasis?: boolean
}

interface StudioAlertDialogReason {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
}

// 알림·확인용 짧은 팝업. 브라우저 기본 alert/confirm 대신 쓴다.
function StudioAlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '확인',
  onConfirm,
  cancelLabel,
  destructive = false,
  pending = false,
  destructiveVariant = 'destructive',
  impacts,
  reason,
  limitHeight = false,
  focusCancelOnOpen = false,
}: StudioAlertDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  const reasonId = React.useId()
  const hasImpacts = Boolean(impacts && impacts.length > 0)
  const reasonMissing = Boolean(reason?.required && !reason.value.trim())

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <StudioDialogPanel
        showCloseButton={false}
        className={cn(limitHeight && 'max-h-[calc(100dvh-2rem)] overflow-y-auto', hasImpacts && 'sm:max-w-[480px]')}
        onOpenAutoFocus={
          focusCancelOnOpen && cancelLabel
            ? (event) => {
                event.preventDefault()
                cancelRef.current?.focus()
              }
            : undefined
        }
      >
        <StudioDialogHeader className={cn(hasImpacts && 'text-left sm:text-left')}>
          <StudioDialogTitle>{title}</StudioDialogTitle>
          {description ? <StudioDialogDescription>{description}</StudioDialogDescription> : null}
        </StudioDialogHeader>
        {hasImpacts ? (
          <dl className="divide-y divide-[var(--studio-border)] rounded-xl border border-[var(--studio-border)] text-sm">
            {impacts!.map((impact) => (
              <div key={impact.label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-[var(--studio-muted)]">{impact.label}</dt>
                <dd className={cn('text-right tabular-nums text-[var(--studio-ink)]', impact.emphasis && 'font-bold')}>
                  {impact.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {reason ? (
          <div className="grid gap-2 text-left">
            <label htmlFor={reasonId} className="text-sm font-semibold text-[var(--studio-ink)]">
              {reason.label}
            </label>
            <textarea
              id={reasonId}
              value={reason.value}
              onChange={(event) => reason.onChange(event.target.value)}
              placeholder={reason.placeholder}
              disabled={pending}
              rows={3}
              className="w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 py-2 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]"
            />
          </div>
        ) : null}
        <StudioDialogFooter>
          {cancelLabel ? (
            <Button ref={cancelRef} type="button" variant="brandOutline" disabled={pending} onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={destructive ? destructiveVariant : 'brand'}
            disabled={pending || reasonMissing}
            onClick={onConfirm}
          >
            {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
            {confirmLabel}
          </Button>
        </StudioDialogFooter>
      </StudioDialogPanel>
    </Dialog>
  )
}

export {
  StudioAlertDialog,
  StudioDialogDescription,
  StudioDialogFooter,
  StudioDialogHeader,
  StudioDialogPanel,
  StudioDialogTitle,
}
