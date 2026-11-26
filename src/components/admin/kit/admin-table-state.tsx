import * as React from 'react'
import { AlertCircle, Inbox, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { ADMIN_TONE_CLASSES } from './admin-tone-classes'

type AdminTableStateProps =
  | { kind: 'loading'; message?: React.ReactNode; className?: string }
  // 비어 있음: 이유 + 다음 행동(버튼·링크)
  | { kind: 'empty'; message: React.ReactNode; action?: React.ReactNode; className?: string }
  // 실패: 무엇을 못 읽었는지 + 다시 시도
  | { kind: 'error'; message: React.ReactNode; onRetry?: () => void; retryLabel?: string; className?: string }

// 표·목록의 불러오는 중·비어 있음·실패(20번 5-2). 세 모양이 서로 다르다.
export function AdminTableState(props: AdminTableStateProps) {
  if (props.kind === 'loading') {
    return (
      <div role="status" className={cn('flex items-center justify-center gap-2 py-10 text-sm text-[var(--studio-muted)]', props.className)}>
        <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        {props.message ?? '불러오는 중'}
      </div>
    )
  }

  if (props.kind === 'empty') {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-[var(--studio-radius-card)] border border-dashed border-[var(--studio-border)] py-10 text-center text-sm text-[var(--studio-text)]',
          props.className
        )}
      >
        <Inbox aria-hidden="true" className="size-6 text-[var(--studio-muted)]" />
        <div className="break-keep">{props.message}</div>
        {props.action ? <div>{props.action}</div> : null}
      </div>
    )
  }

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-[var(--studio-radius-card)] border py-10 text-center text-sm',
        ADMIN_TONE_CLASSES.danger,
        props.className
      )}
    >
      <AlertCircle aria-hidden="true" className="size-6" />
      <div className="break-keep font-medium">{props.message}</div>
      {props.onRetry ? (
        <Button type="button" variant="adminTable" size="sm" onClick={props.onRetry}>
          {props.retryLabel ?? '다시 시도'}
        </Button>
      ) : null}
    </div>
  )
}
