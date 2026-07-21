import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { BoardListController } from '../../_components/board/board-list-controller'
import {
  getSampleBoard,
  getSamplePostsByBoard,
  samplePagination,
} from '../../_data/sample-data'

export const metadata: Metadata = {
  title: '수능특강 국어 문학 자료 | 써머썬 스튜디오',
  description:
    '교재, 작품 유형, 학년별로 국어 문학 자료를 탐색하는 정적 프리뷰 게시판',
}

type BoardSearchParams = Record<string, string | string[] | undefined>

export default async function SolvookConceptBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<BoardSearchParams>
}) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ])
  const board = getSampleBoard(slug)

  if (!board) {
    notFound()
  }

  const posts = getSamplePostsByBoard(board.slug)

  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <div className="h-56 animate-pulse rounded-xl border border-[var(--preview-border)] bg-white" />
        </div>
      }
    >
      <BoardListController
        board={board}
        posts={posts}
        pagination={samplePagination}
        initialSearchParams={resolvedSearchParams}
      />
    </Suspense>
  )
}
