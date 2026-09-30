'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { useListQuery } from '@/hooks/use-list-query'
import type { Database } from '@/types/supabase'

type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']

interface TextbookListboardClientProps {
  boardSlug: string
  posts: GenerateListboardPost[]
}

export default function TextbookListboardClient({ boardSlug, posts }: TextbookListboardClientProps) {
  const listQuery = useListQuery()
  const { page: currentPage, pageSize: rowsPerPage, setPage: setCurrentPage } = listQuery

  const totalPages = Math.max(1, Math.ceil(posts.length / rowsPerPage))
  const visibleCurrentPage = Math.min(currentPage, totalPages)

  const pagedPosts = useMemo(() => {
    const start = (visibleCurrentPage - 1) * rowsPerPage
    return posts.slice(start, start + rowsPerPage)
  }, [posts, rowsPerPage, visibleCurrentPage])

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
                <th className="w-[74px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[108px] sm:px-3">년도</th>
                <th className="w-[64px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[92px] sm:px-3">월</th>
                <th className="w-[74px] px-2 py-3 text-center text-sm font-bold whitespace-nowrap sm:w-[108px] sm:px-3">학년</th>
              </tr>
            </thead>
            <tbody>
              {pagedPosts.map((post, index) => {
                const href = `/generate/boards/${boardSlug}/posts/${post.id}`
                const rowNumber = posts.length - ((visibleCurrentPage - 1) * rowsPerPage + index)

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

      <StudioListPagination page={visibleCurrentPage} pageSize={rowsPerPage} totalCount={posts.length} onPageChange={setCurrentPage} onPageSizeChange={listQuery.setPageSize} />
    </div>
  )
}
