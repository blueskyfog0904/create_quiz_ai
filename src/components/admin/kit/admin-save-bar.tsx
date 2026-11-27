'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatKstTime } from '@/lib/admin-format'
import { cn } from '@/lib/utils'

import { adminSaveBarView, type AdminSaveStatus } from './admin-save-bar-state'
import { ADMIN_TONE_TEXT_CLASSES } from './admin-tone-classes'

export { countChangedFields, type AdminSaveStatus } from './admin-save-bar-state'

interface AdminSaveBarProps {
  // fixed: 아래 고정(저장 함수가 하나인 주소). inline: 저장 영역 안 한 줄(저장 함수가 둘 이상인 주소).
  variant: 'fixed' | 'inline'
  // 저장 안 된 변경 수(화면이 계산한 dirty 값)
  dirtyCount: number
  status: AdminSaveStatus
  // 마지막 저장 시각
  savedAt?: string | number | Date | null
  errorMessage?: React.ReactNode
  // 반영 안내(예: '즉시 반영', '최대 1분 안에 회원 홈에 반영'). 문구는 화면이 준다.
  applyNote?: React.ReactNode
  // 저장 함수 하나(화면 것을 그대로). 저장 바 하나에 저장 함수 하나.
  onSave: () => void
  saveLabel?: string
  saveDisabled?: boolean
  // 변경이 없어도 버튼을 켠다(누르면 화면이 검사·초점 이동을 한다). 기본 false.
  saveWhenClean?: boolean
  className?: string
}

// 저장 상태 표시(20번 5-2·5-3). 표시만 한다: 이탈 경고 훅은 부르지 않는다(지금 훅이 있는 화면이 1회 부름).
// 단축키 저장은 없다(F-03 보류).
export function AdminSaveBar({
  variant,
  dirtyCount,
  status,
  savedAt,
  errorMessage,
  applyNote,
  onSave,
  saveLabel = '저장',
  saveDisabled = false,
  saveWhenClean = false,
  className,
}: AdminSaveBarProps) {
  const view = adminSaveBarView({ status, dirtyCount, hasSavedAt: Boolean(savedAt), saveDisabled, saveWhenClean })
  const saving = view.kind === 'saving'
  let statusText: React.ReactNode
  let statusClass = 'text-[var(--studio-muted)]'
  if (saving) {
    statusText = '저장 중'
  } else if (view.kind === 'error') {
    statusText = errorMessage ?? '저장하지 못했습니다.'
    statusClass = cn('font-medium', ADMIN_TONE_TEXT_CLASSES.danger)
  } else if (view.kind === 'dirty') {
    statusText = `저장 안 된 변경 ${dirtyCount}건`
    statusClass = cn('font-medium', ADMIN_TONE_TEXT_CLASSES.warning)
  } else if (view.kind === 'saved' && savedAt) {
    statusText = `${formatKstTime(savedAt)} 저장됨`
    statusClass = ADMIN_TONE_TEXT_CLASSES.success
  } else {
    statusText = '변경 없음'
  }

  return (
    <div
      data-slot="admin-save-bar"
      data-variant={variant}
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2',
        variant === 'fixed'
          ? 'sticky bottom-0 z-20 mt-6 border-t border-[var(--studio-border)] bg-[var(--studio-surface)] px-4 py-3 shadow-[0_-4px_12px_rgb(40_35_85/6%)]'
          : 'rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] bg-[var(--studio-background)] px-3 py-2',
        className
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p role="status" aria-live="polite" className={cn('flex items-center gap-1.5', statusClass)}>
          {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          {statusText}
        </p>
        {applyNote ? <p className="text-xs text-[var(--studio-muted)]">{applyNote}</p> : null}
      </div>
      <Button
        type="button"
        variant="brand"
        size={variant === 'inline' ? 'sm' : 'default'}
        onClick={onSave}
        disabled={view.disabled}
      >
        {view.retry ? '다시 시도' : saveLabel}
      </Button>
    </div>
  )
}
