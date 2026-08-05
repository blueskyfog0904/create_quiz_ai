'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { MarketBoardCategoryGroup } from '@/lib/market-board'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

const SUBJECT_LABELS: Record<WorkspaceSubject, string> = {
  english: '영어',
  korean: '국어',
}

interface BoardCategorySidebarProps {
  groups: MarketBoardCategoryGroup[]
  categorySlug: string
  currentGroupId: string
  subject: WorkspaceSubject
  search: string
  year: string
  month: string
  grade: string
  sourceType: string
  source1: string
  source2: string
  source3: string
  source4: string
  sort: string
  pageSize: number
}

function buildCategoryHref({
  slug,
  subject,
  search,
  year,
  month,
  grade,
  sourceType,
  source1,
  source2,
  source3,
  source4,
  sort,
  pageSize,
}: {
  slug: string
  subject: WorkspaceSubject
  search: string
  year: string
  month: string
  grade: string
  sourceType: string
  source1: string
  source2: string
  source3: string
  source4: string
  sort: string
  pageSize: number
}) {
  const pathname = `/preview/solvook-concept/boards/${slug}`
  const query = new URLSearchParams()

  query.set('subject', subject)

  if (search) query.set('search', search)
  if (year) query.set('year', year)
  if (month) query.set('month', month)
  if (grade) query.set('grade', grade)
  if (sourceType) query.set('sourceType', sourceType)
  if (source1) query.set('source1', source1)
  if (source2) query.set('source2', source2)
  if (source3) query.set('source3', source3)
  if (source4) query.set('source4', source4)
  if (sort && sort !== 'latest') query.set('sort', sort)
  if (pageSize !== 10) query.set('pageSize', String(pageSize))

  return query.size > 0 ? `${pathname}?${query.toString()}` : `${pathname}?subject=${subject}`
}

function groupPanelId(groupId: string, surface: 'mobile' | 'desktop') {
  return `board-category-${surface}-group-${groupId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

export function BoardCategorySidebar({
  groups,
  categorySlug,
  currentGroupId,
  subject,
  search,
  year,
  month,
  grade,
  sourceType,
  source1,
  source2,
  source3,
  source4,
  sort,
  pageSize,
}: BoardCategorySidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expandedGroupId, setExpandedGroupId] = useState(currentGroupId)

  function renderGroupLinks(
    group: MarketBoardCategoryGroup,
    surface: 'mobile' | 'desktop'
  ) {
    const panelId = groupPanelId(group.id, surface)
    const isExpanded = expandedGroupId === group.id
    const isDesktop = surface === 'desktop'
    const groupTitle = group.isUngrouped ? SUBJECT_LABELS[subject] : group.title

    return (
      <li
        key={group.id}
        className={isDesktop
          ? ''
          : 'rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]'}
      >
        <button
          type="button"
          aria-controls={panelId}
          aria-expanded={isExpanded}
          className={`flex min-h-11 w-full items-center justify-between gap-3 text-left font-extrabold text-[var(--studio-ink)] outline-none transition hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
            isDesktop ? 'px-0 py-2 text-base' : 'px-4 py-3 text-sm'
          }`}
          onClick={() => setExpandedGroupId(isExpanded ? '' : group.id)}
        >
          <span>{groupTitle}</span>
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        <div
          id={panelId}
          hidden={!isExpanded}
          className={isDesktop
            ? 'py-1'
            : 'border-t border-[var(--studio-border)] px-2 py-2'}
        >
          <ul className="space-y-1">
            {group.entries.map((entry) => {
              const isCurrent = entry.slug === categorySlug

              return (
                <li key={entry.id}>
                  <Link
                    href={buildCategoryHref({
                      slug: entry.slug,
                      subject,
                      search,
                      year,
                      month,
                      grade,
                      sourceType,
                      source1,
                      source2,
                      source3,
                      source4,
                      sort,
                      pageSize,
                    })}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={`flex min-h-11 items-center px-2 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                      isCurrent
                        ? isDesktop
                          ? 'font-bold text-[var(--studio-primary)]'
                          : 'rounded-[var(--studio-radius-control)] bg-[var(--studio-primary-soft)] font-extrabold text-[var(--studio-primary)]'
                        : isDesktop
                          ? 'text-[var(--studio-text)] hover:text-[var(--studio-primary)]'
                          : 'rounded-[var(--studio-radius-control)] text-[var(--studio-text)] hover:bg-[var(--studio-primary-soft)] hover:text-[var(--studio-primary)]'
                    }`}
                  >
                    <span className="min-w-0 break-keep">{entry.title}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </li>
    )
  }

  return (
    <>
      <section className="md:hidden">
        <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]">
          <button
            type="button"
            aria-controls="board-mobile-navigation"
            aria-expanded={mobileOpen}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-extrabold text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span>카테고리 탐색</span>
            <ChevronDown
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 transition ${mobileOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <nav
            id="board-mobile-navigation"
            aria-label="카테고리 탐색"
            hidden={!mobileOpen}
            className="border-t border-[var(--studio-border)] p-3"
          >
            <ul className="space-y-3">
              {groups.map((group) => renderGroupLinks(group, 'mobile'))}
            </ul>
          </nav>
        </div>
      </section>

      <aside className="hidden md:block md:self-start">
        <nav aria-label="카테고리 탐색" className="space-y-3">
          <ul className="space-y-3">
            {groups.map((group) => renderGroupLinks(group, 'desktop'))}
          </ul>
        </nav>
      </aside>
    </>
  )
}
