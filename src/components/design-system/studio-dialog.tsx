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

// 회원 화면 팝업 공통 모양(솔북 기준): 흰 판·둥근 모서리, 아이콘 없이 왼쪽 정렬 제목·본문, 아래 버튼은 같은 너비.
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
        !showCloseButton && '[&_[data-slot=dialog-header]]:pr-0',
        className
      )}
      {...props}
    />
  )
}

function StudioDialogHeader({ className, ...props }: React.ComponentProps<typeof DialogHeader>) {
  return <DialogHeader className={cn('gap-2 text-left sm:text-left', className)} {...props} />
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
}: StudioAlertDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen)
      }}
    >
      <StudioDialogPanel showCloseButton={false}>
        <StudioDialogHeader>
          <StudioDialogTitle>{title}</StudioDialogTitle>
          {description ? <StudioDialogDescription>{description}</StudioDialogDescription> : null}
        </StudioDialogHeader>
        <StudioDialogFooter>
          {cancelLabel ? (
            <Button type="button" variant="brandOutline" disabled={pending} onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'brand'}
            disabled={pending}
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
