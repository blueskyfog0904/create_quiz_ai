import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Database } from '@/types/supabase'
import type { ListboardSearchFilters } from '../data'

type GenerateMenuEntry = Database['public']['Tables']['generate_menu_entries']['Row']
type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']

interface TextbookListboardProps {
  board: GenerateMenuEntry
  posts: GenerateListboardPost[]
  filters: ListboardSearchFilters
  options: {
    years: number[]
    months: number[]
    grades: string[]
  }
}

export default function TextbookListboard({ board, posts, filters, options }: TextbookListboardProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{board.title}</h1>
        <p className="mt-2 text-gray-500">문제 검색 후 지문을 선택하면 교재형 문제생성으로 이동합니다.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>문제 검색</CardTitle>
          <CardDescription>년도, 월, 학년, 제목 키워드로 모의고사 지문을 찾을 수 있습니다.</CardDescription>
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
                <Link href={`/generate/boards/${board.slug}`}>초기화</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>검색 결과</CardTitle>
          <CardDescription>총 {posts.length}건</CardDescription>
        </CardHeader>
        <CardContent>
          {posts.length === 0 ? (
            <div className="rounded-lg border border-dashed py-16 text-center text-gray-500">
              검색 조건에 맞는 지문이 없습니다.
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
                  {posts.map((post) => {
                    const href = `/generate/boards/${board.slug}/posts/${post.id}`

                    return (
                    <tr key={post.id} className="border-t transition-colors hover:bg-gray-50">
                      <td className="px-4 py-3 align-top">
                        <Link href={href} className="block font-medium text-gray-900">
                          {post.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        <Link href={href} className="block">
                          {post.exam_year ?? '-'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        <Link href={href} className="block">
                          {post.exam_month ? `${post.exam_month}월` : '-'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        <Link href={href} className="block">
                          {post.grade_level ?? '-'}
                        </Link>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
