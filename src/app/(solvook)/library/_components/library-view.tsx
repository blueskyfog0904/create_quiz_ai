'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, FolderOpen, Loader2, RotateCcw, X } from 'lucide-react'
import { StudioContainer, StudioEmptyState, StudioPagination } from '@/components/design-system'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FileTypeDocIcon } from '@/components/market/file-type-doc-icon'
import type { MarketLibraryRow } from '@/lib/market-items-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface LibraryViewProps {
  rows: MarketLibraryRow[]
  subject: WorkspaceSubject
}

type SortOption = 'latest' | 'name'
type RefundTarget = MarketLibraryRow['refundTargets'][number]

const PAGE_SIZE = 20

// 문제(PDF)의 PDF와 문제(HWP)에 포함된 PDF는 동일 내용이므로, 전자가 있으면 후자를 숨긴다.
// categorySlug가 null이면(매핑 실패) 숨기지 않는 방향으로만 퇴화한다(fail-safe).
function dedupeQuestionPdfFiles(files: MarketLibraryRow['v2DownloadFiles']) {
  const hasQuestionPdfPdf = files.some((file) => (
    file.categorySlug === 'question_pdf' && file.fileTypeCode.toLowerCase() === 'pdf'
  ))
  if (!hasQuestionPdfPdf) return files
  return files.filter((file) => !(
    file.categorySlug === 'question_hwp' && file.fileTypeCode.toLowerCase() === 'pdf'
  ))
}

const SUBJECT_TABS: { value: WorkspaceSubject; label: string }[] = [
  { value: 'english', label: '영어' },
  { value: 'korean', label: '국어' },
]

// DB에 이미 있는 항목만으로 구성한 패싯 정의.
// 이후 교재/단원 등 새 항목이 DB에 채워지면 여기 한 줄 추가로 같은 드롭다운·칩·초기화가 붙는다.
interface LibraryFacet {
  key: string
  label: string
  getValues: (row: MarketLibraryRow) => string[]
}

const LIBRARY_FACETS: LibraryFacet[] = [
  {
    key: 'category',
    label: '카테고리',
    getValues: (row) => (row.categoryTitle ? [row.categoryTitle] : []),
  },
  {
    key: 'type',
    label: '자료유형',
    getValues: (row) => {
      const values = [...row.v2OwnedLabels]
      if (row.pdfOwned) values.push('PDF')
      if (row.hwpOwned) values.push('HWP')
      if (row.zipOwned) values.push('ZIP')
      return values
    },
  },
  {
    key: 'year',
    label: '연도',
    getValues: (row) => (row.examYear ? [String(row.examYear)] : []),
  },
  {
    key: 'grade',
    label: '학년',
    getValues: (row) => (row.gradeLevel ? [row.gradeLevel] : []),
  },
]

type FacetSelections = Record<string, string[]>

function readFacetSelectionsFromParams(params: URLSearchParams): FacetSelections {
  const selections: FacetSelections = {}
  for (const facet of LIBRARY_FACETS) {
    // 값에 어떤 문자가 와도 안전하도록 콤마 join 대신 파라미터 반복(?type=a&type=b)을 쓴다.
    const values = params.getAll(facet.key).map((value) => value.trim()).filter(Boolean)
    if (values.length) {
      selections[facet.key] = values
    }
  }
  return selections
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}.${month}.${day}`
}

const controlClassName =
  'min-h-11 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

const downloadButtonClassName =
  'inline-flex min-h-9 items-center gap-1.5 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm font-medium text-[var(--studio-ink)] transition-colors hover:border-[var(--studio-primary-border)] hover:text-[var(--studio-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'

const refundButtonClassName =
  'inline-flex min-h-9 items-center rounded-[var(--studio-radius-control)] border border-red-500 bg-[var(--studio-surface)] px-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500 hover:text-white disabled:opacity-50 disabled:hover:bg-[var(--studio-surface)] disabled:hover:text-red-600 outline-none focus-visible:ring-2 focus-visible:ring-red-300'


export function LibraryView({ rows, subject }: LibraryViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState('')
  const [facetSelections, setFacetSelections] = useState<FacetSelections>(() => readFacetSelectionsFromParams(new URLSearchParams(searchParams.toString())))
  const [openFacetKey, setOpenFacetKey] = useState<string | null>(null)
  const facetBarRef = useRef<HTMLDivElement | null>(null)
  const [sort, setSort] = useState<SortOption>('latest')
  const [page, setPage] = useState(1)
  const [refundSubmitting, setRefundSubmitting] = useState<string | null>(null)
  const [refundDialogItemId, setRefundDialogItemId] = useState<string | null>(null)
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false)
  const [isSubjectSwitching, startSubjectSwitch] = useTransition()
  const subjectMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!subjectMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (subjectMenuRef.current && !subjectMenuRef.current.contains(event.target as Node)) {
        setSubjectMenuOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSubjectMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [subjectMenuOpen])

  // 패싯 드롭다운 외부 클릭/Escape 닫기
  useEffect(() => {
    if (!openFacetKey) return

    function handlePointerDown(event: PointerEvent) {
      if (facetBarRef.current && !facetBarRef.current.contains(event.target as Node)) {
        setOpenFacetKey(null)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenFacetKey(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openFacetKey])

  // 패싯별 옵션과 개수 (내 소유 자료 전체 기준)
  const facetOptions = useMemo(() => {
    const optionMap = new Map<string, Map<string, number>>()
    for (const facet of LIBRARY_FACETS) {
      optionMap.set(facet.key, new Map())
    }
    for (const row of rows) {
      for (const facet of LIBRARY_FACETS) {
        const counts = optionMap.get(facet.key)!
        for (const value of new Set(facet.getValues(row))) {
          counts.set(value, (counts.get(value) ?? 0) + 1)
        }
      }
    }
    return optionMap
  }, [rows])

  const applyFacetSelections = (next: FacetSelections) => {
    setFacetSelections(next)
    setPage(1)
    const params = new URLSearchParams()
    if (subject === 'korean') params.set('subject', 'korean')
    for (const facet of LIBRARY_FACETS) {
      for (const value of next[facet.key] ?? []) {
        params.append(facet.key, value)
      }
    }
    const query = params.toString()
    window.history.replaceState(null, '', query ? `/library?${query}` : '/library')
  }

  const toggleFacetValue = (facetKey: string, value: string) => {
    const current = facetSelections[facetKey] ?? []
    const next = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]
    applyFacetSelections({ ...facetSelections, [facetKey]: next })
  }

  const resetFilters = () => {
    setSearch('')
    setOpenFacetKey(null)
    applyFacetSelections({})
  }

  const activeChips = LIBRARY_FACETS.flatMap((facet) =>
    (facetSelections[facet.key] ?? []).map((value) => ({ facetKey: facet.key, value }))
  )

  const filteredRows = useMemo(() => {
    // 한글 NFC/NFD(맥 파일명 복붙) 불일치로 검색이 안 되는 문제를 막기 위해 양쪽 모두 NFC로 정규화해 비교한다.
    const keyword = search.trim().toLowerCase().normalize('NFC')
    const nextRows = rows.filter((row) => {
      for (const facet of LIBRARY_FACETS) {
        const selected = facetSelections[facet.key]
        if (selected?.length) {
          const values = facet.getValues(row)
          if (!selected.some((value) => values.includes(value))) return false
        }
      }
      if (keyword && !(`${row.title} ${row.categoryTitle} ${row.summary || ''}`.toLowerCase().normalize('NFC').includes(keyword))) {
        return false
      }
      return true
    })

    nextRows.sort((a, b) => {
      if (sort === 'name') {
        return a.title.localeCompare(b.title, 'ko')
      }
      return b.purchasedAt.localeCompare(a.purchasedAt)
    })

    return nextRows
  }, [rows, search, facetSelections, sort])

  const totalPages = Math.ceil(filteredRows.length / PAGE_SIZE)
  const safePage = Math.min(Math.max(page, 1), Math.max(totalPages, 1))
  const pagedRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // 다이얼로그 내용은 rows에서 파생 — refresh로 행이 갱신/소멸하면 자동 반영된다.
  const refundDialogRow = refundDialogItemId
    ? rows.find((row) => row.itemId === refundDialogItemId) ?? null
    : null

  useEffect(() => {
    // 행이 소멸해 암시적으로 닫힌 경우 stale id를 정리해 재등장 시 재열림을 막는다
    if (refundDialogItemId && !refundDialogRow) {
      setRefundDialogItemId(null)
    }
  }, [refundDialogItemId, refundDialogRow])

  const handleSubjectChange = (nextSubject: WorkspaceSubject) => {
    setSubjectMenuOpen(false)
    if (nextSubject === subject) return
    startSubjectSwitch(() => {
      router.push(nextSubject === 'korean' ? '/library?subject=korean' : '/library')
    })
  }

  const subjectLabel = SUBJECT_TABS.find((tab) => tab.value === subject)?.label ?? '영어'

  const handleRefundRequest = async (target: RefundTarget): Promise<boolean> => {
    if (target.status !== 'available') {
      alert(target.reason ?? '현재 환불 신청할 수 없습니다.')
      return false
    }

    if (!confirm(`${target.label} 환불을 신청하시겠습니까?`)) {
      return false
    }

    setRefundSubmitting(target.targetId)
    try {
      const response = await fetch('/api/market/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetKind: target.targetKind,
          targetId: target.targetId,
        }),
      })
      const result = await response.json().catch(() => null)

      if (!response.ok || !result?.success) {
        throw new Error(result?.error?.message ?? '환불 신청 처리에 실패했습니다.')
      }

      alert('환불 신청이 접수되었습니다.')
      router.refresh()
      return true
    } catch (error) {
      alert(error instanceof Error ? error.message : '환불 신청 처리에 실패했습니다.')
      return false
    } finally {
      setRefundSubmitting(null)
    }
  }

  return (
    <StudioContainer className="py-8 sm:py-10">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">자료 보관함</h1>
        <div ref={subjectMenuRef} className="relative">
          <button
            type="button"
            aria-haspopup="true"
            aria-expanded={subjectMenuOpen}
            onClick={() => setSubjectMenuOpen((open) => !open)}
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-2xl font-bold text-[var(--studio-primary)] outline-none hover:bg-[var(--studio-primary-soft)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] sm:text-3xl"
          >
            {subjectLabel}
            {isSubjectSwitching ? (
              <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
            ) : (
              <ChevronDown
                aria-hidden="true"
                className={`h-5 w-5 transition-transform ${subjectMenuOpen ? 'rotate-180' : ''}`}
              />
            )}
          </button>
          {subjectMenuOpen && (
            <div
              role="radiogroup"
              aria-label="과목 선택"
              className="absolute left-0 top-full z-20 mt-1 w-36 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] py-2 shadow-[var(--studio-shadow-card)]"
            >
              {SUBJECT_TABS.map((tab) => {
                const selected = tab.value === subject
                return (
                  <button
                    key={tab.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleSubjectChange(tab.value)}
                    className="flex min-h-11 w-full items-center gap-2.5 px-4 text-left text-base font-medium text-[var(--studio-ink)] outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-focus-ring)]"
                  >
                    <span
                      aria-hidden="true"
                      className={`grid size-4 shrink-0 place-items-center rounded-full border ${
                        selected ? 'border-[var(--studio-primary)]' : 'border-[var(--studio-control-border)]'
                      }`}
                    >
                      {selected && <span className="size-2 rounded-full bg-[var(--studio-primary)]" />}
                    </span>
                    {tab.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-[var(--studio-muted)]">
        구매한 자료를 확인하고 파일을 다운로드할 수 있습니다.
      </p>

      <div
        aria-busy={isSubjectSwitching}
        className={isSubjectSwitching ? 'pointer-events-none opacity-50 transition-opacity' : 'transition-opacity'}
      >
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
          placeholder="자료명·유형 검색"
          className={`${controlClassName} w-full sm:w-64`}
          aria-label="보관함 검색"
        />
        <select
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as SortOption)
            setPage(1)
          }}
          className={`${controlClassName} sm:ml-auto`}
          aria-label="정렬"
        >
          <option value="latest">최근 구매 순</option>
          <option value="name">이름 순</option>
        </select>
      </div>

      <div ref={facetBarRef} className="mt-3 flex flex-wrap items-center gap-2">
        {LIBRARY_FACETS.map((facet) => {
          const counts = facetOptions.get(facet.key) ?? new Map<string, number>()
          const options = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ko'))
          const selectedCount = facetSelections[facet.key]?.length ?? 0
          // 선택지가 아예 없을 때만 비활성 (1개뿐이어도 열어서 확인·선택 가능)
          const disabled = options.length === 0 && selectedCount === 0
          const open = openFacetKey === facet.key
          return (
            <div key={facet.key} className="relative">
              <button
                type="button"
                disabled={disabled}
                aria-haspopup="true"
                aria-expanded={open}
                onClick={() => setOpenFacetKey(open ? null : facet.key)}
                className={`inline-flex min-h-10 items-center gap-1 rounded-lg border bg-[var(--studio-surface)] px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                  selectedCount > 0
                    ? 'border-[var(--studio-ink)] font-bold text-[var(--studio-ink)]'
                    : disabled
                      ? 'cursor-not-allowed border-[var(--studio-border)] font-medium text-[var(--studio-muted)] opacity-50'
                      : 'border-[var(--studio-control-border)] font-medium text-[var(--studio-muted)] hover:border-[var(--studio-ink)] hover:text-[var(--studio-ink)]'
                }`}
              >
                {facet.label}
                {selectedCount > 0 && <span>{selectedCount}</span>}
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>
              {open && (
                <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] py-2 shadow-[var(--studio-shadow-card)]">
                  {options.map(([value, count]) => {
                    const checked = facetSelections[facet.key]?.includes(value) ?? false
                    return (
                      <label
                        key={value}
                        className="flex min-h-10 cursor-pointer items-center gap-2.5 px-4 text-sm text-[var(--studio-ink)] hover:bg-[var(--studio-background)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFacetValue(facet.key, value)}
                          className="size-4 accent-[var(--studio-primary)]"
                        />
                        <span className="min-w-0 flex-1 truncate">{value}</span>
                        <span className="text-xs text-[var(--studio-muted)]">{count}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(activeChips.length > 0 || search.trim() !== '') && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-black/5 px-4 py-2">
          {activeChips.map((chip) => (
            <button
              key={`${chip.facetKey}:${chip.value}`}
              type="button"
              onClick={() => toggleFacetValue(chip.facetKey, chip.value)}
              aria-label={`${chip.value} 필터 제거`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-[var(--studio-text)] outline-none hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              {chip.value}
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-[var(--studio-text)] outline-none hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            초기화
          </button>
        </div>
      )}

      {pagedRows.length === 0 ? (
        <div className="mt-6">
          <StudioEmptyState
            icon={<FolderOpen className="size-6" aria-hidden />}
            title={rows.length === 0 ? '구매한 자료가 없습니다' : '조건에 맞는 자료가 없습니다'}
            description={
              rows.length === 0
                ? '문제마켓에서 자료를 구매하면 이곳에서 확인하고 다운로드할 수 있습니다.'
                : '검색어나 자료유형 필터를 변경해 보세요.'
            }
            action={
              rows.length === 0 ? (
                <Link
                  href={subject === 'korean' ? '/?subject=korean' : '/'}
                  className="inline-flex min-h-11 items-center rounded-[var(--studio-radius-control)] bg-[var(--studio-primary)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--studio-primary-hover)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  문제마켓 둘러보기
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--studio-border)] rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]">
          {pagedRows.map((row) => {
            const hasPendingRefund = row.refundTargets.some((target) => target.status === 'pending')
            const availableRefundTargets = row.refundTargets.filter((target) => target.status === 'available')
            const detailHref = row.categorySlug
              ? `/${subject}/market/${row.categorySlug}/items/${row.itemId}`
              : null
            const visibleV2Files = dedupeQuestionPdfFiles(row.v2DownloadFiles)
            const v2SubproductCount = new Set(visibleV2Files.map((file) => file.subproductId)).size
            const buildV2DownloadLabel = (file: MarketLibraryRow['v2DownloadFiles'][number]) =>
              v2SubproductCount > 1 ? `${file.subproductTitle} (${file.fileTypeLabel})` : `${file.fileTypeLabel} 다운로드`
            const legacyDownloads = [
              row.pdfAvailable && row.pdfDownloadUrl ? { key: 'pdf', label: 'PDF 다운로드', url: row.pdfDownloadUrl } : null,
              row.hwpAvailable && row.hwpDownloadUrl ? { key: 'hwp', label: 'HWP 다운로드', url: row.hwpDownloadUrl } : null,
              row.zipAvailable && row.zipDownloadUrl ? { key: 'zip', label: 'ZIP 다운로드', url: row.zipDownloadUrl } : null,
            ].filter((entry): entry is { key: string; label: string; url: string } => entry !== null)

            return (
              <li key={row.itemId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-[var(--studio-primary-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--studio-primary)]">
                      {row.categoryTitle}
                    </span>
                    {hasPendingRefund && (
                      <span className="inline-flex items-center rounded-full bg-[var(--studio-highlight)] px-2.5 py-0.5 text-xs font-semibold text-[var(--studio-ink)]">
                        환불 심사 중 (다운로드 제한)
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5">
                    {detailHref ? (
                      <Link
                        href={detailHref}
                        className="text-base font-semibold text-[var(--studio-ink)] hover:text-[var(--studio-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                      >
                        {row.title}
                      </Link>
                    ) : (
                      <span className="text-base font-semibold text-[var(--studio-ink)]">{row.title}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--studio-muted)]">
                    구매일 {formatDate(row.purchasedAt)}
                    {row.lastDownloadedAt ? ` · 최근 다운로드 ${formatDate(row.lastDownloadedAt)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {availableRefundTargets.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setRefundDialogItemId(row.itemId)}
                      className={refundButtonClassName}
                    >
                      환불 신청
                    </button>
                  )}
                  {visibleV2Files.map((file) =>
                    hasPendingRefund ? (
                      <span key={file.id} className={`${downloadButtonClassName} cursor-not-allowed opacity-50`}>
                        <FileTypeDocIcon code={file.fileTypeCode} />
                        {buildV2DownloadLabel(file)}
                      </span>
                    ) : (
                      <a key={file.id} href={file.downloadUrl} className={downloadButtonClassName}>
                        <FileTypeDocIcon code={file.fileTypeCode} />
                        {buildV2DownloadLabel(file)}
                      </a>
                    )
                  )}
                  {legacyDownloads.map((entry) =>
                    hasPendingRefund ? (
                      <span key={entry.key} className={`${downloadButtonClassName} cursor-not-allowed opacity-50`}>
                        <FileTypeDocIcon code={entry.key} />
                        {entry.label}
                      </span>
                    ) : (
                      <a key={entry.key} href={entry.url} className={downloadButtonClassName}>
                        <FileTypeDocIcon code={entry.key} />
                        {entry.label}
                      </a>
                    )
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-6">
          <StudioPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
      </div>

      {(() => {
        return (
          <Dialog
            open={refundDialogRow !== null}
            onOpenChange={(open) => {
              if (!open) setRefundDialogItemId(null)
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>환불 신청</DialogTitle>
                <DialogDescription className="break-keep">
                  {refundDialogRow?.title}
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-[var(--studio-muted)]">
                환불할 구매 건을 선택하세요.
              </p>
              <ul className="space-y-3">
                {(refundDialogRow?.refundTargets ?? []).map((target) => (
                  <li
                    key={target.targetId}
                    className="rounded-lg border border-[var(--studio-border)] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-keep text-sm font-semibold text-[var(--studio-ink)]">
                          {target.label}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--studio-muted)]">
                          구매일 {formatDate(target.purchasedAt)} · 환불 예정{' '}
                          {target.requestedRefundCredits.toLocaleString()} 크레딧
                        </p>
                      </div>
                      {target.status === 'available' ? (
                        <button
                          type="button"
                          disabled={refundSubmitting === target.targetId}
                          onClick={async () => {
                            const succeeded = await handleRefundRequest(target)
                            if (succeeded) setRefundDialogItemId(null)
                          }}
                          className={refundButtonClassName}
                        >
                          {refundSubmitting === target.targetId ? '신청 중…' : '이 건 환불 신청'}
                        </button>
                      ) : target.status === 'pending' ? (
                        <span className="inline-flex items-center rounded-full bg-[var(--studio-background)] px-2.5 py-1 text-xs font-semibold text-[var(--studio-muted)]">
                          심사 중
                        </span>
                      ) : (
                        <span className="max-w-[12rem] break-keep text-right text-xs text-[var(--studio-muted)]">
                          {target.reason ?? '환불할 수 없는 구매 건입니다.'}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </DialogContent>
          </Dialog>
        )
      })()}
    </StudioContainer>
  )
}
