import { cn } from '@/lib/utils'

// 사이드바(256px)·본문 여백(64px)을 뺀 xl(1280px) 본문 폭. 표의 최소 폭이 이보다 넓으면 xl 이상에서도 표 안 가로 스크롤.
export const ADMIN_TABLE_PAGE_WIDTH_LIMIT = 960

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

interface AdminTableCellClassInput {
  first: boolean
  wide: boolean
  dense: boolean
  align: keyof typeof ALIGN_CLASS
  numeric?: boolean
  className?: string
}

// 넓이 규칙(20번 5-2): xl 미만은 표 안 가로 스크롤 + 첫 열 고정, xl 이상(넓지 않은 표)은 머리 고정.
// 첫 열의 sticky left 는 xl 이상에서도 그대로 둔다(가로 넘침이 없으면 효과 없음). xl:static 을 섞으면
// tailwind-merge 가 머리 고정(xl:sticky)을 지우므로 쓰지 않는다(시험이 merge 결과로 확인).
export function adminTableHeadCellClass({ first, wide, dense, align, className }: AdminTableCellClassInput) {
  return cn(
    dense ? 'h-8' : 'h-10',
    'whitespace-nowrap bg-[var(--studio-background)] px-3 font-semibold text-[var(--studio-muted)]',
    ALIGN_CLASS[align],
    first && 'sticky left-0 z-[2]',
    !wide && 'xl:sticky xl:top-0 xl:z-10',
    first && !wide && 'xl:z-20',
    className
  )
}

export function adminTableBodyCellClass({ first, dense, align, numeric, className }: AdminTableCellClassInput) {
  return cn(
    dense ? 'h-8' : 'h-10',
    'px-3 align-middle',
    ALIGN_CLASS[align],
    numeric && 'tabular-nums',
    first && 'sticky left-0 z-[1] bg-[var(--studio-surface)]',
    className
  )
}
