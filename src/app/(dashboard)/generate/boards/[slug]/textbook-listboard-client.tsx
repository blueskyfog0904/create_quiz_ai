'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react'
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
      <div className="overflow-x-auto rounded-xl border">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="min-w-[320px] px-4 py-3 text-left font-medium">제목</th>
              <th className="w-[140px] px-4 py-3 text-center font-medium whitespace-nowrap">년도</th>
              <th className="w-[120px] px-4 py-3 text-center font-medium whitespace-nowrap">월</th>
              <th className="w-[140px] px-4 py-3 text-center font-medium whitespace-nowrap">학년</th>
            </tr>
          </thead>
          <tbody>
            {pagedPosts.map((post, index) => {
              const href = `/generate/boards/${boardSlug}/posts/${post.id}`
              const isStripedRow = index % 2 === 1

              return (
                <tr
                  key={post.id}
                  className={`border-t transition-colors hover:bg-slate-100/60 ${isStripedRow ? 'bg-slate-50/70' : 'bg-white'}`}
                >
                  <td className="px-4 py-3 align-top text-left">
                    <Link href={href} className="block space-y-1">
                      <div className="font-medium text-gray-900">{post.title}</div>
                      <div className="text-xs text-gray-500">
                        {post.exam_year ?? '-'} / {post.exam_month ? `${post.exam_month}월` : '-'} / {post.grade_level ?? '-'}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700 whitespace-nowrap">
                    <Link href={href} className="block">
                      {post.exam_year ?? '-'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700 whitespace-nowrap">
                    <Link href={href} className="block">
                      {post.exam_month ? `${post.exam_month}월` : '-'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700 whitespace-nowrap">
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

      <div className="grid gap-3 rounded-xl border bg-gray-50/70 px-4 py-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="hidden md:block" />
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={visibleCurrentPage === 1}
                onClick={() => setCurrentPage(1)}
              >
                <ChevronsLeft className="h-4 w-4" />
            </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={visibleCurrentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
            </Button>
            {visiblePageNumbers.map((pageNumber) => (
                <Button
                  key={pageNumber}
                  type="button"
                  variant={pageNumber === visibleCurrentPage ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCurrentPage(pageNumber)}
                >
                {pageNumber}
              </Button>
            ))}
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={visibleCurrentPage === totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              >
                <ChevronRight className="h-4 w-4" />
            </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={visibleCurrentPage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
              >
                <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
          <span>표시 개수</span>
          <select
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
  )
}
