import { WorkspaceLink } from '@/components/layout/workspace-link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  variant?: 'default' | 'previewHeaderOnly'
  options: {
    years: number[]
    months: number[]
    grades: string[]
  }
}

export default function MarketListboard({ category, rows, filters, isLoggedIn, resetHref, variant = 'default', options }: MarketListboardProps) {
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
    <div className="space-y-6">
      <div className={`overflow-hidden rounded-2xl border ${subjectTheme.marketHeroClass} p-6 text-white shadow-sm`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className={`text-sm font-medium ${subjectTheme.marketHeroLabelClass}`}>{workspaceLabel}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{category.title}</h1>
            <p className={`mt-3 max-w-2xl text-sm leading-6 ${subjectTheme.marketHeroMutedTextClass}`}>
              연도·월·학년별 모의고사 자료를 PDF/HWP/ZIP으로 선택해 바로 구매할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-white/15 text-white hover:bg-white/15">총 {rows.length}건</Badge>
            <Badge className="bg-white/15 text-white hover:bg-white/15">PDF/HWP/ZIP</Badge>
            {sampleCount > 0 ? <Badge className="bg-white/15 text-white hover:bg-white/15">샘플 제공 {sampleCount}건</Badge> : null}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>자료 찾기</CardTitle>
          <CardDescription>원하는 연도, 월, 학년, 제목으로 자료를 빠르게 찾으세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <label htmlFor="year" className="text-sm font-medium text-gray-700">년도</label>
              <select id="year" name="year" defaultValue={filters.year || ''} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                <option value="">전체</option>
                {options.years.map((year) => (
                  <option key={year} value={String(year)}>{year}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="month" className="text-sm font-medium text-gray-700">월</label>
              <select id="month" name="month" defaultValue={filters.month || ''} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                <option value="">전체</option>
                {options.months.map((month) => (
                  <option key={month} value={String(month)}>{month}월</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="grade" className="text-sm font-medium text-gray-700">학년</label>
              <select id="grade" name="grade" defaultValue={filters.grade || ''} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                <option value="">전체</option>
                {options.grades.map((grade) => (
                  <option key={grade} value={grade}>{grade}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="title" className="text-sm font-medium text-gray-700">제목</label>
              <input id="title" name="title" defaultValue={filters.title || ''} placeholder="제목 검색" className="flex h-10 w-full rounded-md border bg-white px-3 text-sm" />
            </div>
            <div className="md:col-span-4 flex items-center gap-2">
              <Button type="submit">검색</Button>
              <Button type="button" variant="outline" asChild>
                <WorkspaceLink href={resetHref ?? `/market/${category.slug}`}>초기화</WorkspaceLink>
              </Button>
            </div>
            {activeFilterChips.length > 0 ? (
              <div className="md:col-span-4 flex flex-wrap items-center gap-2 border-t pt-4">
                <span className="text-xs font-medium text-gray-500">적용된 조건</span>
                {activeFilterChips.map((chip) => (
                  <Badge key={chip} variant="secondary" className="rounded-full">{chip}</Badge>
                ))}
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {variant === 'default' ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <CardTitle>검색 결과</CardTitle>
                <CardDescription>총 {rows.length}건의 자료를 확인할 수 있습니다.</CardDescription>
              </div>
              <p className="text-xs text-gray-500">필요한 파일만 선택해 일괄 결제하세요.</p>
            </div>
          </CardHeader>
          <CardContent>
            <MarketListboardClient categorySlug={category.slug} workspaceSubject={category.workspace_subject} rows={rows} isLoggedIn={isLoggedIn} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
