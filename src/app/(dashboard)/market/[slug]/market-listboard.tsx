import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { MarketListboardRow } from '@/lib/market-items-server'
import type { Database } from '@/types/supabase'
import MarketListboardClient from './market-listboard-client'

type MarketMenuEntry = Database['public']['Tables']['market_menu_entries']['Row']

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
  options: {
    years: number[]
    months: number[]
    grades: string[]
  }
}

export default function MarketListboard({ category, rows, filters, options }: MarketListboardProps) {
  return (
    <div className="space-y-6 pb-28">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{category.title}</h1>
        <p className="mt-2 text-gray-500">리스트보드에서 PDF/HWP를 선택한 뒤 바로 일괄 결제할 수 있습니다.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>문제 검색</CardTitle>
          <CardDescription>년도, 월, 학년, 제목 키워드로 문제마켓 자료를 찾을 수 있습니다.</CardDescription>
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
                <Link href={`/market/${category.slug}`}>초기화</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>검색 결과</CardTitle>
          <CardDescription>총 {rows.length}건</CardDescription>
        </CardHeader>
        <CardContent>
          <MarketListboardClient categorySlug={category.slug} rows={rows} />
        </CardContent>
      </Card>
    </div>
  )
}
