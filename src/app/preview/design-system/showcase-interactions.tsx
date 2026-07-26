'use client'

import { useState } from 'react'

import {
  StudioDialogContent,
  StudioPagination,
  StudioSelectContent,
} from '@/components/design-system'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const exampleSurfaceClassName =
  'min-w-0 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)]'

export function ShowcaseInteractions() {
  const [page, setPage] = useState(2)

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-2">
      <section
        aria-labelledby="showcase-dialog-heading"
        className={exampleSurfaceClassName}
      >
        <h2
          id="showcase-dialog-heading"
          className="text-xl font-extrabold text-[var(--studio-ink)]"
        >
          Dialog
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">
          Portal 안에서도 Studio 색상과 키보드 포커스가 유지됩니다.
        </p>
        <div className="mt-5">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="brandOutline">Dialog 열기</Button>
            </DialogTrigger>
            <StudioDialogContent>
              <DialogHeader>
                <DialogTitle className="text-[var(--studio-ink)]">
                  학습 자료 확인
                </DialogTitle>
                <DialogDescription className="text-[var(--studio-muted)]">
                  제목, 설명, 닫기 버튼의 기본 접근성 계약을 확인하는
                  예시입니다.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-[var(--studio-radius-control)] bg-[var(--studio-primary-soft)] p-4 text-sm leading-6 text-[var(--studio-text)]">
                실제 데이터 없이 공통 Dialog surface만 렌더링합니다.
              </div>
            </StudioDialogContent>
          </Dialog>
        </div>
      </section>

      <section
        aria-labelledby="showcase-select-heading"
        className={exampleSurfaceClassName}
      >
        <h2
          id="showcase-select-heading"
          className="text-xl font-extrabold text-[var(--studio-ink)]"
        >
          Select
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">
          Trigger와 portal item 모두 최소 44px 입력 영역을 가집니다.
        </p>
        <div className="mt-5 space-y-2">
          <Label htmlFor="showcase-level">난이도</Label>
          <Select defaultValue="middle">
            <SelectTrigger
              id="showcase-level"
              className="min-h-11 w-full border-[var(--studio-control-border)] bg-[var(--studio-surface)] focus-visible:ring-[var(--studio-focus-ring)]"
            >
              <SelectValue placeholder="난이도를 선택하세요" />
            </SelectTrigger>
            <StudioSelectContent>
              <SelectItem value="easy">기초</SelectItem>
              <SelectItem value="middle">중급</SelectItem>
              <SelectItem value="advanced">심화</SelectItem>
            </StudioSelectContent>
          </Select>
        </div>
      </section>

      <section
        aria-labelledby="showcase-pagination-heading"
        className={`${exampleSurfaceClassName} lg:col-span-2`}
      >
        <h2
          id="showcase-pagination-heading"
          className="text-base font-bold text-[var(--studio-ink)]"
        >
          Controlled pagination
        </h2>
        <p aria-live="polite" className="mt-1 text-sm text-[var(--studio-muted)]">
          현재 {page}페이지
        </p>
        <div className="mt-4 overflow-x-auto pb-1">
          <StudioPagination
            page={page}
            totalPages={8}
            onPageChange={setPage}
          />
        </div>
      </section>
    </div>
  )
}
