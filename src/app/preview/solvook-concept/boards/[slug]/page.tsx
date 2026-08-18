import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { notFound } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import {
  StudioContainer,
  StudioEmptyState,
  StudioPageHeader,
} from '@/components/design-system'
import { Button } from '@/components/ui/button'
import { getMarketBoardData } from '@/lib/market-board-server'
import type { MarketBoardSort } from '@/lib/market-board'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  RealMarketBoard,
  type RealMarketBoardFilterState,
} from '../../_components/board/real-market-board'

export const metadata: Metadata = {
  title: '문제마켓 게시판 프리뷰 | 써머썬 스튜디오',
  description: '영어와 국어 실제 문제마켓 자료를 탐색하는 게시판 프리뷰',
}

type BoardSearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function resolveSubject(value?: string): WorkspaceSubject {
  return value === 'korean' ? 'korean' : 'english'
}

function parsePositiveInteger(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseSort(value: string | undefined): MarketBoardSort | undefined {
  return value === 'views' || value === 'latest'
    ? value
    : undefined
}

export default async function SolvookConceptBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<BoardSearchParams>
}) {
  await connection()

  const [{ slug }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ])

  const subject = resolveSubject(firstValue(resolvedSearchParams.subject))
  const filters: RealMarketBoardFilterState = {
    search: firstValue(resolvedSearchParams.search) ?? '',
    year: firstValue(resolvedSearchParams.year) ?? '',
    sort: parseSort(firstValue(resolvedSearchParams.sort)) ?? 'views',
  }

  const result = await getMarketBoardData({
    subject,
    slug,
    search: filters.search || undefined,
    examYear: parsePositiveInteger(filters.year),
    sort: filters.sort,
    page: parsePositiveInteger(firstValue(resolvedSearchParams.page)),
  })

  if (result.status === 'not_found') {
    notFound()
  }

  if (result.status === 'error') {
    const resetHref = `/preview/solvook-concept/boards/${slug}?subject=${subject}`

    return (
      <>
        <div className="studio-reference-gutter">
          <StudioPageHeader
            eyebrow="MARKET BOARD"
            title="게시판 자료를 불러오지 못했습니다"
            description="현재 공개 게시판 데이터를 확인하지 못했습니다. 같은 과목 기준으로 다시 시도하거나 홈으로 이동해 주세요."
          />
        </div>
        <div className="studio-reference-gutter overflow-x-hidden py-8 sm:py-10">
          <StudioContainer>
            <StudioEmptyState
              icon={<AlertCircle className="size-6" />}
              title="연결 상태를 다시 확인해 주세요"
              description={result.message}
              action={(
                <>
                  <Button asChild variant="brand">
                    <Link href={resetHref}>현재 게시판 다시 보기</Link>
                  </Button>
                  <Button asChild variant="brandOutline">
                    <Link href={`/preview/solvook-concept?subject=${subject}`}>
                      문제마켓 홈으로 이동
                    </Link>
                  </Button>
                </>
              )}
            />
          </StudioContainer>
        </div>
      </>
    )
  }

  return (
    <RealMarketBoard
      data={result.data}
      filters={filters}
    />
  )
}
