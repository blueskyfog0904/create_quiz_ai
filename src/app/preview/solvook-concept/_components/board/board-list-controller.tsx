'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  FormEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Eye,
  FileQuestion,
  FileSearch,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import {
  StudioBoardShell,
  StudioEmptyState,
  StudioFilterPanel,
  StudioPageHeader,
  StudioPagination,
  StudioSelectContent,
} from '@/components/design-system'
import { StudioBoardPageFrame } from '@/components/page-templates'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  SampleBoard,
  SampleData,
  SampleMaterialPost,
} from '../../_data/sample-data'
import { SamplePreviewDialog } from './sample-preview-dialog'

const previewRoot = '/preview/solvook-concept'
const allValue = 'all'
const supportedSorts = ['latest', 'views', 'questions'] as const

type SortValue = (typeof supportedSorts)[number]
type QueryKey =
  | 'q'
  | 'year'
  | 'textbook'
  | 'workType'
  | 'grade'
  | 'sort'
  | 'size'
  | 'page'
type FilterQueryKey = 'q' | 'year' | 'textbook' | 'workType' | 'grade'

interface BoardListControllerProps {
  board: SampleBoard
  posts: SampleMaterialPost[]
  pagination: SampleData['pagination']
  initialSearchParams: Record<string, string | string[] | undefined>
}

interface ActiveQuery {
  q: string
  year: string
  textbook: string
  workType: string
  grade: string
  sort: SortValue
  size: number
  page: number
}

interface FilterSelectProps {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parsePositiveInteger(value: string | null | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function formatPublishedAt(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(`${value}T00:00:00`))
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: FilterSelectProps) {
  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-xs font-extrabold text-[var(--studio-text)]">
        {label}
      </span>
      <Select value={value || allValue} onValueChange={onChange}>
        <SelectTrigger
          aria-label={`${label} 필터`}
          className="h-11 w-full border-[var(--studio-control-border)] bg-[var(--studio-surface)] text-[var(--studio-text)] shadow-none focus-visible:border-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]"
        >
          <SelectValue placeholder={`${label} 전체`} />
        </SelectTrigger>
        <StudioSelectContent>
          <SelectItem value={allValue}>{label} 전체</SelectItem>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </StudioSelectContent>
      </Select>
    </div>
  )
}

function SampleUnavailableButton({ postId }: { postId: string }) {
  const descriptionId = `sample-unavailable-${postId}`

  return (
    <span className="inline-flex flex-col items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        aria-describedby={descriptionId}
        className="min-h-11 border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]"
      >
        미제공
      </Button>
      <span id={descriptionId} className="sr-only">
        이 자료는 샘플 미리보기를 제공하지 않습니다.
      </span>
    </span>
  )
}

export function BoardListController({
  board,
  posts,
  pagination,
  initialSearchParams,
}: BoardListControllerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initialQ = firstValue(initialSearchParams.q) ?? ''
  const searchInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const sampleTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [selectedSamplePost, setSelectedSamplePost] =
    useState<SampleMaterialPost | null>(null)
  const [sampleDialogOpen, setSampleDialogOpen] = useState(false)

  const activeQuery = useMemo<ActiveQuery>(() => {
    const initialSize = parsePositiveInteger(
      firstValue(initialSearchParams.size),
      pagination.defaultPageSize
    )
    const requestedSize = parsePositiveInteger(
      searchParams.get('size'),
      initialSize
    )
    const size = pagination.pageSizes.includes(requestedSize)
      ? requestedSize
      : pagination.defaultPageSize
    const requestedSort = searchParams.get('sort')
    const initialSort = firstValue(initialSearchParams.sort)
    const sortCandidate = requestedSort ?? initialSort
    const sort = supportedSorts.includes(sortCandidate as SortValue)
      ? (sortCandidate as SortValue)
      : 'latest'

    return {
      q: searchParams.get('q') ?? initialQ,
      year:
        searchParams.get('year') ?? firstValue(initialSearchParams.year) ?? '',
      textbook:
        searchParams.get('textbook') ??
        firstValue(initialSearchParams.textbook) ??
        '',
      workType:
        searchParams.get('workType') ??
        firstValue(initialSearchParams.workType) ??
        '',
      grade:
        searchParams.get('grade') ??
        firstValue(initialSearchParams.grade) ??
        '',
      sort,
      size,
      page: parsePositiveInteger(
        searchParams.get('page') ?? firstValue(initialSearchParams.page),
        1
      ),
    }
  }, [initialQ, initialSearchParams, pagination, searchParams])

  const replaceQuery = useCallback(
    (
      updates: Partial<Record<QueryKey, string | number | null>>,
      resetPage = false
    ) => {
      const next = new URLSearchParams(searchParams.toString())

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '' || value === allValue) {
          next.delete(key)
        } else {
          next.set(key, String(value))
        }
      }

      if (resetPage) {
        next.delete('page')
      }

      const query = next.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
    },
    [pathname, router, searchParams]
  )

  const filteredPosts = useMemo(() => {
    const normalizedSearch = activeQuery.q.trim().toLocaleLowerCase('ko-KR')
    const matches = posts.filter((post) => {
      const searchableText = [
        post.title,
        post.textbook,
        post.workType,
        post.summary,
        post.authorLabel,
        ...post.questions.map((question) => question.type),
      ]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
      const matchesSearch =
        normalizedSearch.length === 0 ||
        searchableText.includes(normalizedSearch)

      return (
        matchesSearch &&
        (!activeQuery.year || post.year === activeQuery.year) &&
        (!activeQuery.textbook || post.textbook === activeQuery.textbook) &&
        (!activeQuery.workType || post.workType === activeQuery.workType) &&
        (!activeQuery.grade || post.grade === activeQuery.grade)
      )
    })

    return [...matches].sort((left, right) => {
      if (activeQuery.sort === 'views') {
        return right.viewCount - left.viewCount
      }

      if (activeQuery.sort === 'questions') {
        return right.questions.length - left.questions.length
      }

      return right.publishedAt.localeCompare(left.publishedAt)
    })
  }, [activeQuery, posts])

  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / activeQuery.size))
  const currentPage = Math.min(activeQuery.page, totalPages)
  const visiblePosts = filteredPosts.slice(
    (currentPage - 1) * activeQuery.size,
    currentPage * activeQuery.size
  )

  useEffect(() => {
    for (const input of Object.values(searchInputRefs.current)) {
      if (input && input.value !== activeQuery.q) {
        input.value = activeQuery.q
      }
    }
  }, [activeQuery.q])

  useEffect(() => {
    if (activeQuery.page !== currentPage) {
      replaceQuery({ page: currentPage === 1 ? null : currentPage })
    }
  }, [activeQuery.page, currentPage, replaceQuery])

  const activeChips: Array<{ key: FilterQueryKey; label: string }> = []

  if (activeQuery.q) {
    activeChips.push({ key: 'q', label: `검색: ${activeQuery.q}` })
  }
  if (activeQuery.year) {
    activeChips.push({ key: 'year', label: `연도: ${activeQuery.year}` })
  }
  if (activeQuery.textbook) {
    activeChips.push({
      key: 'textbook',
      label: `교재: ${activeQuery.textbook}`,
    })
  }
  if (activeQuery.workType) {
    activeChips.push({
      key: 'workType',
      label: `유형: ${activeQuery.workType}`,
    })
  }
  if (activeQuery.grade) {
    activeChips.push({ key: 'grade', label: `학년: ${activeQuery.grade}` })
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const query = String(data.get('q') ?? '').trim()
    replaceQuery({ q: query || null }, true)
  }

  function resetAll() {
    const next = new URLSearchParams(searchParams.toString())

    for (const key of [
      'q',
      'year',
      'textbook',
      'workType',
      'grade',
      'sort',
      'size',
      'page',
    ]) {
      next.delete(key)
    }

    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

  function handleSampleDialogOpenChange(open: boolean) {
    setSampleDialogOpen(open)
  }

  function openSampleDialog(
    event: MouseEvent<HTMLButtonElement>,
    post: SampleMaterialPost
  ) {
    sampleTriggerRef.current = event.currentTarget
    setSelectedSamplePost(post)
    setSampleDialogOpen(true)
  }

  function renderFilterPanel(searchId: string) {
    return (
      <StudioFilterPanel
        fields={
          <form
            onSubmit={submitSearch}
            role="search"
            className="grid gap-3 md:grid-cols-[minmax(220px,1.7fr)_repeat(4,minmax(120px,1fr))]"
          >
            <div className="min-w-0">
              <label
                htmlFor={searchId}
                className="mb-1.5 block text-xs font-extrabold text-[var(--studio-text)]"
              >
                제목 검색
              </label>
              <div className="flex gap-2">
                <Input
                  id={searchId}
                  name="q"
                  type="search"
                  defaultValue={activeQuery.q}
                  ref={(input) => {
                    searchInputRefs.current[searchId] = input
                  }}
                  placeholder="작품명 또는 자료명"
                  className="h-11 border-[var(--studio-control-border)] bg-[var(--studio-surface)] shadow-none focus-visible:border-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]"
                />
                <Button
                  type="submit"
                  size="icon"
                  aria-label="제목 검색 적용"
                  variant="brand"
                  className="h-11 w-11"
                >
                  <Search aria-hidden="true" />
                </Button>
              </div>
            </div>
            <FilterSelect
              label="연도"
              value={activeQuery.year}
              options={board.filters.years}
              onChange={(value) => replaceQuery({ year: value }, true)}
            />
            <FilterSelect
              label="교재"
              value={activeQuery.textbook}
              options={board.filters.textbooks}
              onChange={(value) => replaceQuery({ textbook: value }, true)}
            />
            <FilterSelect
              label="작품 유형"
              value={activeQuery.workType}
              options={board.filters.workTypes}
              onChange={(value) => replaceQuery({ workType: value }, true)}
            />
            <FilterSelect
              label="학년"
              value={activeQuery.grade}
              options={board.filters.grades}
              onChange={(value) => replaceQuery({ grade: value }, true)}
            />
          </form>
        }
        activeFilters={
          activeChips.length > 0 ? (
            <>
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => replaceQuery({ [chip.key]: null }, true)}
                  className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded-full bg-[var(--studio-primary-soft)] px-3 text-xs font-bold text-[var(--studio-primary)] outline-none hover:bg-[var(--studio-primary-border)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  {chip.label}
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                  <span className="sr-only">필터 제거</span>
                </button>
              ))}
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex min-h-11 min-w-11 items-center gap-1 rounded-[var(--studio-radius-control)] px-2 text-xs font-bold text-[var(--studio-muted)] outline-none hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                전체 초기화
              </button>
            </>
          ) : undefined
        }
      />
    )
  }

  return (
    <>
      <StudioBoardPageFrame
        header={
          <StudioPageHeader
            breadcrumbs={
              <>
                <Link
                  href={previewRoot}
                  className="inline-flex min-h-11 min-w-11 items-center rounded-[var(--studio-radius-control)] outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  홈
                </Link>
                <span aria-hidden="true">/</span>
                <span aria-current="page">국어 자료</span>
              </>
            }
            eyebrow="KOREAN LITERATURE BOARD"
            title={board.title}
            description={board.description}
            actions={
              <Badge
                variant="outline"
                className="min-h-11 border-[var(--studio-primary-border)] bg-[var(--studio-primary-soft)] px-3 font-extrabold text-[var(--studio-primary)]"
              >
                전체 자료 {posts.length}개
              </Badge>
            }
          />
        }
        filters={renderFilterPanel('board-title-search')}
        results={
          <StudioBoardShell
          summary={
            <p
              className="text-sm font-bold text-[var(--studio-text)]"
            >
              검색 결과{' '}
              <strong className="text-[var(--studio-primary)]">
                {filteredPosts.length}
              </strong>
              개
              {filteredPosts.length > 0 && (
                <span className="ml-2 font-medium text-[var(--studio-muted)]">
                  {currentPage}/{totalPages}페이지
                </span>
              )}
            </p>
          }
          toolbar={
            <>
              <Select
                value={activeQuery.sort}
                onValueChange={(value) =>
                  replaceQuery(
                    { sort: value === 'latest' ? null : value },
                    true
                  )
                }
              >
                <SelectTrigger
                  aria-label="자료 정렬"
                  className="!h-11 min-w-[138px] border-[var(--studio-control-border)] bg-[var(--studio-surface)] shadow-none"
                >
                  <SelectValue />
                </SelectTrigger>
                <StudioSelectContent>
                  <SelectItem value="latest">최신순</SelectItem>
                  <SelectItem value="views">조회순</SelectItem>
                  <SelectItem value="questions">문항 많은 순</SelectItem>
                </StudioSelectContent>
              </Select>
              <Select
                value={String(activeQuery.size)}
                onValueChange={(value) =>
                  replaceQuery(
                    {
                      size:
                        Number(value) === pagination.defaultPageSize
                          ? null
                          : value,
                    },
                    true
                  )
                }
              >
                <SelectTrigger
                  aria-label="페이지당 자료 수"
                  className="!h-11 min-w-[104px] border-[var(--studio-control-border)] bg-[var(--studio-surface)] shadow-none"
                >
                  <SelectValue />
                </SelectTrigger>
                <StudioSelectContent>
                  {pagination.pageSizes.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}개씩
                    </SelectItem>
                  ))}
                </StudioSelectContent>
              </Select>
            </>
          }
          desktopResults={
            visiblePosts.length > 0 ? (
              <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]">
                <Table>
                <TableHeader className="bg-[var(--studio-background)]">
                  <TableRow className="hover:bg-[var(--studio-background)]">
                    <TableHead className="w-[92px] px-3 text-xs font-extrabold">
                      유형
                    </TableHead>
                    <TableHead className="min-w-[280px] text-xs font-extrabold">
                      자료명
                    </TableHead>
                    <TableHead className="min-w-[150px] text-xs font-extrabold">
                      교재·출처
                    </TableHead>
                    <TableHead className="w-[72px] px-3 text-xs font-extrabold">
                      학년
                    </TableHead>
                    <TableHead className="w-[116px] px-3 text-xs font-extrabold">
                      구성
                    </TableHead>
                    <TableHead className="w-[92px] px-3 text-center text-xs font-extrabold">
                      샘플
                    </TableHead>
                    <TableHead className="w-[88px] px-3 text-right text-xs font-extrabold">
                      조회
                    </TableHead>
                    <TableHead className="w-[110px] px-3 text-right text-xs font-extrabold">
                      등록일
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePosts.map((post) => {
                    const detailHref = `${pathname}/posts/${post.id}`

                    return (
                      <TableRow
                        key={post.id}
                        className="group hover:bg-[var(--studio-primary-soft)]"
                      >
                        <TableCell className="px-3">
                          <Badge
                            variant="outline"
                            className="border-[var(--studio-primary-border)] bg-[var(--studio-primary-soft)] text-[10px] font-extrabold text-[var(--studio-primary)]"
                          >
                            {post.workType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={detailHref}
                            className="block min-h-11 min-w-11 rounded-[var(--studio-radius-control)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                          >
                            <span className="line-clamp-2 font-extrabold leading-5 text-[var(--studio-ink)] transition-colors group-hover:text-[var(--studio-primary)]">
                              {post.title}
                            </span>
                            <span className="mt-1 block truncate text-xs text-[var(--studio-muted)]">
                              {post.authorLabel}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="block text-xs font-bold text-[var(--studio-text)]">
                            {post.textbook}
                          </span>
                          <span className="mt-1 block text-[11px] text-[var(--studio-muted)]">
                            {post.year}
                          </span>
                        </TableCell>
                        <TableCell className="px-3 text-xs font-bold">
                          {post.grade}
                        </TableCell>
                        <TableCell className="px-3 text-xs font-semibold text-[var(--studio-muted)]">
                          지문 {post.passages.length}
                          <br />
                          문항 {post.questions.length}
                        </TableCell>
                        <TableCell className="px-3 text-center">
                          {post.hasSample ? (
                            <Button
                              type="button"
                              variant="brandOutline"
                              size="sm"
                              aria-label={`${post.title} 샘플 보기`}
                              className="min-h-11 font-extrabold"
                              onClick={(event) => openSampleDialog(event, post)}
                            >
                              보기
                            </Button>
                          ) : (
                            <SampleUnavailableButton postId={post.id} />
                          )}
                        </TableCell>
                        <TableCell className="px-3 text-right text-xs font-semibold text-[var(--studio-muted)]">
                          {post.viewCount.toLocaleString('ko-KR')}
                        </TableCell>
                        <TableCell className="px-3 text-right text-xs text-[var(--studio-muted)]">
                          {formatPublishedAt(post.publishedAt)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
                </Table>
              </div>
            ) : (
              <StudioEmptyState
                icon={<FileSearch aria-hidden="true" className="h-7 w-7" />}
                title="조건에 맞는 자료가 없습니다"
                description="검색어를 줄이거나 선택한 필터를 초기화해 보세요."
                action={
                  <Button type="button" variant="brand" onClick={resetAll}>
                    <RotateCcw aria-hidden="true" />
                    전체 조건 초기화
                  </Button>
                }
              />
            )
          }
          mobileResults={
            visiblePosts.length > 0 ? (
              <div className="space-y-3">
                {visiblePosts.map((post) => {
                const detailHref = `${pathname}/posts/${post.id}`

                return (
                  <article
                    key={post.id}
                    className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4 shadow-[var(--studio-shadow-card)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          className="border-[var(--studio-primary-border)] bg-[var(--studio-primary-soft)] text-[10px] font-extrabold text-[var(--studio-primary)]"
                        >
                          {post.workType}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="border-[var(--studio-border)] text-[10px] font-bold text-[var(--studio-muted)]"
                        >
                          {post.grade}
                        </Badge>
                      </div>
                      <span className="text-[10px] font-semibold text-[var(--studio-muted)]">
                        {formatPublishedAt(post.publishedAt)}
                      </span>
                    </div>
                    <Link
                      href={detailHref}
                      className="mt-3 block min-h-11 min-w-11 rounded-[var(--studio-radius-control)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                    >
                      <h2 className="break-keep text-base font-black leading-6 tracking-[-0.02em] text-[var(--studio-ink)]">
                        {post.title}
                      </h2>
                      <p className="mt-1 text-xs text-[var(--studio-muted)]">
                        {post.authorLabel}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-[var(--studio-muted)]">
                        {post.textbook} · {post.year}
                      </p>
                      <p className="mt-3 line-clamp-2 break-keep text-xs leading-5 text-[var(--studio-muted)]">
                        {post.summary}
                      </p>
                    </Link>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--studio-border)] pt-3">
                      <div className="flex items-center gap-3 text-xs font-semibold text-[var(--studio-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <FileQuestion aria-hidden="true" className="h-3.5 w-3.5" />
                          지문 {post.passages.length} · 문항 {post.questions.length}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                          {post.viewCount.toLocaleString('ko-KR')}
                        </span>
                      </div>
                      {post.hasSample ? (
                        <Button
                          type="button"
                          variant="brandOutline"
                          size="sm"
                          aria-label={`${post.title} 샘플 보기`}
                          className="min-h-11 font-extrabold"
                          onClick={(event) => openSampleDialog(event, post)}
                        >
                          샘플
                        </Button>
                      ) : (
                        <SampleUnavailableButton postId={`mobile-${post.id}`} />
                      )}
                    </div>
                  </article>
                )
                })}
              </div>
            ) : (
              <StudioEmptyState
                icon={<FileSearch aria-hidden="true" className="h-7 w-7" />}
                title="조건에 맞는 자료가 없습니다"
                description="검색어를 줄이거나 선택한 필터를 초기화해 보세요."
                action={
                  <Button type="button" variant="brand" onClick={resetAll}>
                    <RotateCcw aria-hidden="true" />
                    전체 조건 초기화
                  </Button>
                }
              />
            )
          }
          pagination={
            totalPages > 1 ? (
              <StudioPagination
                page={currentPage}
                totalPages={totalPages}
                onPageChange={(page) =>
                  replaceQuery({ page: page === 1 ? null : page })
                }
              />
            ) : undefined
          }
          />
        }
      />
      {selectedSamplePost ? (
        <SamplePreviewDialog
          post={selectedSamplePost}
          open={sampleDialogOpen}
          onOpenChange={handleSampleDialogOpenChange}
          returnFocusRef={sampleTriggerRef}
        />
      ) : null}
    </>
  )
}
