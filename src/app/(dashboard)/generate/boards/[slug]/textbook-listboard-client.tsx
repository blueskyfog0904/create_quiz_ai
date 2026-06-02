'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Database } from '@/types/supabase'

type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']

interface TextbookListboardClientProps {
  boardSlug: string
  posts: GenerateListboardPost[]
}

const PER_PAGE_OPTIONS = [10, 20, 30] as const

export default function TextbookListboardClient({ boardSlug, posts }: TextbookListboardClientProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState<number>(10)

  const totalPages = Math.max(1, Math.ceil(posts.length / rowsPerPage))
  const visibleCurrentPage = Math.min(currentPage, totalPages)

  const pagedPosts = useMemo(() => {
    const start = (visibleCurrentPage - 1) * rowsPerPage
    return posts.slice(start, start + rowsPerPage)
  }, [posts, rowsPerPage, visibleCurrentPage])

  const visiblePageNumbers = useMemo(() => {
    const windowSize = 5
    const start = Math.max(1, visibleCurrentPage - 2)
    const end = Math.min(totalPages, start + windowSize - 1)
    const adjustedStart = Math.max(1, end - windowSize + 1)
    return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index)
  }, [totalPages, visibleCurrentPage])

  if (posts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-gray-500">
        검색 조건에 맞는 지문이 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="overflow-x-auto sm:overflow-visible">
          <table className="w-full table-fixed border-collapse text-sm">
            <thead className="border-t-2 border-slate-950 bg-slate-50 text-slate-700">
              <tr className="border-b">
                <th className="w-[46px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[64px] sm:px-3">번호</th>
                <th className="px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:px-3">자료명</th>
                <th className="w-[74px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[96px] sm:px-3">년도</th>
                <th className="w-[64px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[82px] sm:px-3">월</th>
                <th className="w-[74px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[96px] sm:px-3">학년</th>
              </tr>
            </thead>
            <tbody>
              {pagedPosts.map((post, index) => {
                const href = `/generate/boards/${boardSlug}/posts/${post.id}`
                const rowNumber = (visibleCurrentPage - 1) * rowsPerPage + index + 1

                return (
                  <tr key={post.id} className="border-b border-slate-200 bg-white transition hover:bg-slate-50/80">
                    <td className="px-2 py-2 text-center text-slate-500 whitespace-nowrap sm:px-3">{rowNumber}</td>
                    <td className="min-w-0 px-2 py-2 sm:px-3">
                      <Link href={href} className="block min-w-0 truncate font-semibold text-slate-900 hover:text-slate-600">
                        {post.title}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-center text-slate-600 whitespace-nowrap sm:px-3">
                      <Link href={href} className="block">
                        {post.exam_year ?? '-'}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-center text-slate-600 whitespace-nowrap sm:px-3">
                      <Link href={href} className="block">
                        {post.exam_month ? `${post.exam_month}월` : '-'}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-center text-slate-600 whitespace-nowrap sm:px-3">
                      <Link href={href} className="block">
                        {post.grade_level ?? '-'}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 space-y-4 pb-[env(safe-area-inset-bottom)]">
        <div className="grid gap-3 rounded-xl border bg-white px-4 py-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div className="text-center text-xs text-slate-500 md:text-left">
            총 {posts.length}건 · {visibleCurrentPage}/{totalPages} 페이지
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5 justify-self-center">
            <Button type="button" variant="ghost" size="sm" disabled={visibleCurrentPage === 1} onClick={() => setCurrentPage(1)} aria-label="첫 페이지">
              첫 페이지
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={visibleCurrentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} aria-label="이전 페이지">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {visiblePageNumbers.map((pageNumber) => (
              <Button
                key={pageNumber}
                type="button"
                variant={pageNumber === visibleCurrentPage ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setCurrentPage(pageNumber)}
                aria-label={`${pageNumber} 페이지`}
              >
                {pageNumber}
              </Button>
            ))}
            <Button type="button" variant="ghost" size="icon-sm" disabled={visibleCurrentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} aria-label="다음 페이지">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={visibleCurrentPage === totalPages} onClick={() => setCurrentPage(totalPages)} aria-label="마지막 페이지">
              끝 페이지
            </Button>
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-gray-600 md:justify-end">
            <label htmlFor="generate-board-rows-per-page">표시 개수</label>
            <select
              id="generate-board-rows-per-page"
              value={rowsPerPage}
              onChange={(event) => {
                setRowsPerPage(Number(event.target.value))
                setCurrentPage(1)
              }}
              className="flex h-9 rounded-md border bg-white px-3 text-sm"
            >
              {PER_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
