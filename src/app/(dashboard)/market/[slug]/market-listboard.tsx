import { WorkspaceLink } from '@/components/layout/workspace-link'
import {
  StudioBoardShell,
  StudioFilterPanel,
  StudioPageHeader,
} from '@/components/design-system'
import { StudioBoardPageFrame } from '@/components/page-templates'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { MarketListboardRow, MarketMenuEntry } from '@/lib/market-items-server'
import { getWorkspaceSubjectTheme } from '@/lib/workspace-theme'
import MarketListboardClient from './market-listboard-client'

export interface MarketListboardFilters {
  year?: string
  month?: string
  grade?: string
  title?: string
}

interface MarketListboardProps {
  category: MarketMenuEntry
  rows: MarketListboardRow[]
  filters: MarketListboardFilters
  isLoggedIn: boolean
  resetHref?: string
  options: {
    years: number[]
    months: number[]
    grades: string[]
  }
}

export default function MarketListboard({ category, rows, filters, isLoggedIn, resetHref, options }: MarketListboardProps) {
  const activeFilterChips = [
    filters.year ? `${filters.year}년` : null,
    filters.month ? `${filters.month}월` : null,
    filters.grade || null,
    filters.title ? `"${filters.title}"` : null,
  ].filter(Boolean) as string[]
  const sampleCount = rows.filter((row) => row.sample.available).length
  const workspaceLabel = category.workspace_subject === 'korean' ? '국어문제마켓' : '영어문제마켓'
  const subjectTheme = getWorkspaceSubjectTheme(category.workspace_subject)

  return (
    <StudioBoardPageFrame
      header={(
        <div
          className={`${subjectTheme.marketHeroClass} [&>header]:border-transparent [&>header]:bg-transparent [&_h1]:text-white`}
        >
          <StudioPageHeader
            eyebrow={(
              <span className={`${subjectTheme.marketHeroLabelClass}`}>
                {workspaceLabel}
              </span>
            )}
            title={category.title}
            description={(
              <span className={`${subjectTheme.marketHeroMutedTextClass}`}>
                연도·월·학년별 자료를 확인하고 상세페이지에서 필요한 파일을 구매할 수 있습니다.
              </span>
            )}
            meta={(
              <>
                <Badge className="bg-white/15 text-white hover:bg-white/15">총 {rows.length}건</Badge>
                <Badge className="bg-white/15 text-white hover:bg-white/15">PDF/HWP/ZIP</Badge>
                {sampleCount > 0 ? <Badge className="bg-white/15 text-white hover:bg-white/15">샘플 제공 {sampleCount}건</Badge> : null}
              </>
            )}
          />
        </div>
      )}
      filters={(
        <div className="space-y-3">
          <div>
            <h2 className="text-xl font-extrabold text-[var(--studio-ink)]">자료 찾기</h2>
            <p className="mt-1 text-sm text-[var(--studio-muted)]">
              원하는 연도, 월, 학년, 제목으로 자료를 빠르게 찾으세요.
            </p>
          </div>
          <form>
            <StudioFilterPanel
              fields={(
                <div className="grid w-full gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <label htmlFor="year" className="text-sm font-medium text-[var(--studio-text)]">년도</label>
                    <select id="year" name="year" defaultValue={filters.year || ''} className="flex min-h-11 min-w-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm">
                      <option value="">전체</option>
                      {options.years.map((year) => (
                        <option key={year} value={String(year)}>{year}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="month" className="text-sm font-medium text-[var(--studio-text)]">월</label>
                    <select id="month" name="month" defaultValue={filters.month || ''} className="flex min-h-11 min-w-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm">
                      <option value="">전체</option>
                      {options.months.map((month) => (
                        <option key={month} value={String(month)}>{month}월</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="grade" className="text-sm font-medium text-[var(--studio-text)]">학년</label>
                    <select id="grade" name="grade" defaultValue={filters.grade || ''} className="flex min-h-11 min-w-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm">
                      <option value="">전체</option>
                      {options.grades.map((grade) => (
                        <option key={grade} value={grade}>{grade}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="title" className="text-sm font-medium text-[var(--studio-text)]">제목</label>
                    <input id="title" name="title" defaultValue={filters.title || ''} placeholder="제목 검색" className="flex min-h-11 min-w-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm" />
                  </div>
                </div>
              )}
              activeFilters={activeFilterChips.length > 0 ? (
                <>
                  <span className="text-xs font-medium text-[var(--studio-muted)]">적용된 조건</span>
                  {activeFilterChips.map((chip) => (
                    <Badge key={chip} variant="secondary" className="rounded-full">{chip}</Badge>
                  ))}
                </>
              ) : undefined}
              actions={(
                <>
                  <Button type="submit" variant="brand">검색</Button>
                  <Button type="button" variant="brandOutline" asChild>
                    <WorkspaceLink href={resetHref ?? `/market/${category.slug}`}>초기화</WorkspaceLink>
                  </Button>
                </>
              )}
            />
          </form>
        </div>
      )}
      results={(
        <StudioBoardShell
          summary={(
            <div>
              <h2 className="text-xl font-extrabold text-[var(--studio-ink)]">검색 결과</h2>
              <p className="mt-1 text-sm text-[var(--studio-muted)]">총 {rows.length}건의 자료를 확인할 수 있습니다.</p>
            </div>
          )}
          toolbar={<p className="text-xs text-[var(--studio-muted)]">샘플을 확인한 뒤 상세페이지에서 구매하세요.</p>}
          results={(
            <MarketListboardClient categorySlug={category.slug} workspaceSubject={category.workspace_subject} rows={rows} isLoggedIn={isLoggedIn} />
          )}
        />
      )}
    />
  )
}
