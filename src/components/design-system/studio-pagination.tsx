'use client'

import type { MouseEvent, ReactNode } from 'react'

import { Button } from '@/components/ui/button'

interface StudioPaginationNavigationText {
  first: ReactNode
  previous: ReactNode
  next: ReactNode
  last: ReactNode
}

interface StudioPaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  getPageHref?: (page: number) => string
  navigationText?: StudioPaginationNavigationText
}

const paginationControlClassName = 'min-h-11 min-w-11 px-3'
const DEFAULT_NAVIGATION_TEXT: StudioPaginationNavigationText = {
  first: '처음',
  previous: '이전',
  next: '다음',
  last: '마지막',
}

export function StudioPagination({
  page,
  totalPages,
  onPageChange,
  getPageHref,
  navigationText,
}: StudioPaginationProps) {
  const pageCount = Math.max(
    0,
    Math.floor(Number.isFinite(totalPages) ? totalPages : 0)
  )

  if (pageCount === 0) return null

  const currentPage = Math.min(
    pageCount,
    Math.max(1, Math.floor(Number.isFinite(page) ? page : 1))
  )
  const firstPage = currentPage <= 1
  const lastPage = currentPage >= pageCount
  const pageWindowStart = Math.max(
    1,
    Math.min(currentPage - 2, pageCount - 4)
  )
  const visiblePages = Array.from(
    { length: Math.min(5, pageCount) },
    (_, index) => pageWindowStart + index
  )
  const resolvedNavigationText = navigationText ?? DEFAULT_NAVIGATION_TEXT

  function handleLinkClick(
    event: MouseEvent<HTMLAnchorElement>,
    targetPage: number
  ) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    onPageChange(targetPage)
  }

  function renderControl({
    targetPage,
    label,
    disabled = false,
    current = false,
    controlKey,
    children,
  }: {
    targetPage: number
    label: string
    disabled?: boolean
    current?: boolean
    controlKey?: string
    children: ReactNode
  }) {
    if (!disabled && getPageHref) {
      const href = getPageHref(targetPage)

      return (
        <Button
          key={controlKey}
          asChild
          variant={current ? 'brand' : 'brandGhost'}
          className={paginationControlClassName}
        >
          <a
            href={href}
            aria-label={label}
            aria-current={current ? 'page' : undefined}
            onClick={(event) => handleLinkClick(event, targetPage)}
          >
            {children}
          </a>
        </Button>
      )
    }

    return (
      <Button
        key={controlKey}
        type="button"
        variant={current ? 'brand' : 'brandGhost'}
        className={paginationControlClassName}
        aria-label={label}
        aria-current={current ? 'page' : undefined}
        disabled={disabled}
        onClick={() => onPageChange(targetPage)}
      >
        {children}
      </Button>
    )
  }

  return (
    <nav aria-label="페이지네이션">
      <div className="flex flex-wrap items-center justify-center gap-1">
        {renderControl({
          targetPage: 1,
          label: '첫 페이지',
          disabled: firstPage,
          children: resolvedNavigationText.first,
        })}
        {renderControl({
          targetPage: Math.max(1, currentPage - 1),
          label: '이전 페이지',
          disabled: firstPage,
          children: resolvedNavigationText.previous,
        })}

        {visiblePages.map((pageNumber) =>
          renderControl({
            targetPage: pageNumber,
            label: `${pageNumber}페이지`,
            current: pageNumber === currentPage,
            controlKey: `page-${pageNumber}`,
            children: pageNumber,
          })
        )}

        {renderControl({
          targetPage: Math.min(pageCount, currentPage + 1),
          label: '다음 페이지',
          disabled: lastPage,
          children: resolvedNavigationText.next,
        })}
        {renderControl({
          targetPage: pageCount,
          label: '마지막 페이지',
          disabled: lastPage,
          children: resolvedNavigationText.last,
        })}
      </div>
    </nav>
  )
}
