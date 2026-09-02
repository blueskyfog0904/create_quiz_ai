'use client'

import { useEffect, useState, type RefObject } from 'react'
import Link from 'next/link'
import { StudioContainer } from '@/components/design-system'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface CategoryMenuItem {
  id: string
  title: string
}

interface CategoryMenuGroup {
  id: string
  title: string
  items: CategoryMenuItem[]
}

interface CategoryMenuData {
  english: CategoryMenuGroup[]
  korean: CategoryMenuGroup[]
}

interface CategoryMegaMenuProps {
  open: boolean
  currentSubject: WorkspaceSubject
  onClose: () => void
  /** 헤더가 외부 클릭·mouseleave 판정에 쓰는 패널 루트 ref */
  panelRef?: RefObject<HTMLDivElement | null>
}

const SUBJECTS: { value: WorkspaceSubject; label: string }[] = [
  { value: 'english', label: '영어' },
  { value: 'korean', label: '국어' },
]

function normalizeGroups(value: unknown): CategoryMenuGroup[] {
  return Array.isArray(value) ? (value as CategoryMenuGroup[]) : []
}

// 헤더 '카테고리' 메가메뉴 패널 — <header> 직속 자식으로 마운트되어 헤더 아래 전체폭으로 펼쳐진다.
export function CategoryMegaMenu({ open, currentSubject, onClose, panelRef }: CategoryMegaMenuProps) {
  const [menu, setMenu] = useState<CategoryMenuData | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [activeSubject, setActiveSubject] = useState<WorkspaceSubject>(currentSubject)

  // 메뉴 트리는 마운트 후 1회만 조회한다 (실패 시 조용히 빈 상태 유지).
  useEffect(() => {
    let cancelled = false
    fetch('/api/market/category-menu')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return
        if (payload?.success && payload.data) {
          setMenu({
            english: normalizeGroups(payload.data.english),
            korean: normalizeGroups(payload.data.korean),
          })
        }
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 패널이 열릴 때마다 현재 페이지 과목을 기본 활성 과목으로 되돌린다 (렌더 중 상태 보정 패턴).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setActiveSubject(currentSubject)
  }

  if (!open) return null

  const groups = menu?.[activeSubject] ?? []
  const activeSubjectLabel = activeSubject === 'korean' ? '국어' : '영어'

  return (
    <div
      ref={panelRef}
      className="absolute inset-x-0 top-full border-b border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]"
    >
      <StudioContainer className="flex gap-6 py-6 sm:gap-8">
        <nav aria-label="카테고리 과목" className="w-28 shrink-0 border-r border-[var(--studio-border)] pr-4 sm:w-32">
          <ul className="flex flex-col gap-1">
            {SUBJECTS.map(({ value, label }) => {
              const active = value === activeSubject
              return (
                <li key={value}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onMouseEnter={() => setActiveSubject(value)}
                    onFocus={() => setActiveSubject(value)}
                    onClick={() => setActiveSubject(value)}
                    className={`flex min-h-9 w-full items-center rounded-md px-3 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                      active
                        ? 'bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]'
                        : 'text-[var(--studio-muted)] hover:bg-[var(--studio-background)] hover:text-[var(--studio-ink)]'
                    }`}
                  >
                    {label}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          {!loaded ? (
            <p className="break-keep py-1.5 text-sm text-[var(--studio-muted)]">불러오는 중…</p>
          ) : groups.length === 0 ? (
            <p className="break-keep py-1.5 text-sm text-[var(--studio-muted)]">
              {activeSubjectLabel} 카테고리는 준비 중입니다.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-8">
              {groups.map((group) => (
                <section key={group.id} className="min-w-0">
                  <h3 className="break-keep text-sm font-bold text-[var(--studio-ink)]">{group.title}</h3>
                  <ul className="mt-2 flex flex-col">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <Link
                          href={`/categories/${item.id}?subject=${activeSubject}`}
                          onClick={onClose}
                          className="flex min-h-9 items-center break-keep rounded-md text-sm text-[var(--studio-muted)] outline-none hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                        >
                          {item.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </StudioContainer>
    </div>
  )
}
