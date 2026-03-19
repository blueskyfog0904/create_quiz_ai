import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Database } from '@/types/supabase'

type MarketMenuEntry = Database['public']['Tables']['market_menu_entries']['Row']
type MarketItem = Database['public']['Tables']['market_items']['Row']

export interface MarketListboardFilters {
  year?: string
  month?: string
  grade?: string
  title?: string
}

interface MarketListboardProps {
  category: MarketMenuEntry
  items: MarketItem[]
  filters: MarketListboardFilters
  options: {
    years: number[]
    months: number[]
    grades: string[]
  }
}

export default function MarketListboard({ category, items, filters, options }: MarketListboardProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{category.title}</h1>
        <p className="mt-2 text-gray-500">문제 검색 후 자료를 선택하면 해당 자료의 상세 및 구매 화면으로 이동합니다.</p>
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
          <CardDescription>총 {items.length}건</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed py-16 text-center text-gray-500">
              검색 조건에 맞는 자료가 없습니다.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">제목</th>
                    <th className="w-[140px] px-4 py-3 font-medium whitespace-nowrap">년도</th>
                    <th className="w-[120px] px-4 py-3 font-medium whitespace-nowrap">월</th>
                    <th className="w-[140px] px-4 py-3 font-medium whitespace-nowrap">학년</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const href = `/market/${category.slug}/items/${item.id}`

                    return (
                      <tr key={item.id} className="border-t transition-colors hover:bg-gray-50">
                        <td className="px-4 py-3 align-top">
                          <Link href={href} className="block font-medium text-gray-900">
                            {item.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          <Link href={href} className="block">
                            {item.exam_year ?? '-'}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          <Link href={href} className="block">
                            {item.exam_month ? `${item.exam_month}월` : '-'}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          <Link href={href} className="block">
                            {item.grade_level ?? '-'}
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
