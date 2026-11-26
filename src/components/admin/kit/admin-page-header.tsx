import * as React from 'react'

import { cn } from '@/lib/utils'

interface AdminPageHeaderProps {
  // 화면 제목(DB 메뉴 이름을 화면이 넘긴다)
  title: React.ReactNode
  description?: React.ReactNode
  // 오른쪽 도구 칸: 과목 전환기·기간·새로고침·주요 버튼 1개 등 여러 개
  tools?: React.ReactNode
  // 아래 보조 줄: '마지막 갱신 15:12 · 한국 시간 기준' 등
  meta?: React.ReactNode
  className?: string
}

// 관리자 화면 제목줄(20번 5-2). 그리기만 한다.
export function AdminPageHeader({ title, description, tools, meta, className }: AdminPageHeaderProps) {
  return (
    <header className={cn('mb-6 flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="break-keep text-2xl font-bold text-[var(--studio-ink)]">{title}</h1>
          {description ? <p className="break-keep text-sm text-[var(--studio-muted)]">{description}</p> : null}
        </div>
        {tools ? <div className="flex flex-wrap items-center gap-2">{tools}</div> : null}
      </div>
      {meta ? <div className="text-xs text-[var(--studio-muted)]">{meta}</div> : null}
    </header>
  )
}
