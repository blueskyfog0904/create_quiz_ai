'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Eye, FileText, Lock, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { WorkspaceLink } from '@/components/layout/workspace-link'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'
import { useLoginRedirect } from '@/hooks/use-login-redirect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { MarketListboardAssetRow, MarketListboardRow } from '@/lib/market-items-server'

interface MarketListboardClientProps {
  categorySlug: string
  rows: MarketListboardRow[]
  isLoggedIn: boolean
}

type AssetKind = 'pdf' | 'hwp'
const PER_PAGE_OPTIONS = [10, 20, 30] as const

function formatPublishedDate(value: string) {
  return new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function getSelectionKey(itemId: string, assetKind: AssetKind) {
  return `${itemId}:${assetKind}`
}

function getAssetLabel(assetKind: AssetKind) {
  return assetKind === 'pdf' ? 'PDF' : 'PDF & HWP'
}

function formatExamMeta(row: MarketListboardRow) {
  return [
    row.examYear ? `${row.examYear}년` : null,
    row.examMonth ? `${row.examMonth}월` : null,
    row.gradeLevel,
  ].filter(Boolean).join(' · ') || '시험 정보 미등록'
}

function getPurchaseErrorMessage(status: number, fallback?: string) {
  if (status === 401) {
    return '로그인이 필요합니다. 로그인 후 다시 결제해주세요.'
  }

  if (status === 402) {
    return fallback || '크레딧이 부족합니다. 충전 후 다시 시도해주세요.'
  }

  if (status === 409) {
    return fallback || '이미 구매한 파일입니다. 보유 상태를 새로고침합니다.'
  }

  if (status >= 500) {
    return fallback || '서버 오류로 결제에 실패했습니다. 잠시 후 다시 시도해주세요.'
  }

  return fallback || '선택 파일 결제에 실패했습니다.'
}

function getAssetStateLabel(asset: MarketListboardAssetRow, selected: boolean) {
  if (asset.owned) return '보유'
  if (!asset.available) return '미제공'
  if (selected) return '선택됨'
  return '구매 가능'
}

export default function MarketListboardClient({ categorySlug, rows, isLoggedIn }: MarketListboardClientProps) {
  const router = useRouter()
  const { redirectToLogin } = useLoginRedirect()
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState<number>(10)

  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage
    return rows.slice(start, start + rowsPerPage)
  }, [currentPage, rows, rowsPerPage])

  const visiblePageNumbers = useMemo(() => {
    const windowSize = 5
    const start = Math.max(1, currentPage - 2)
    const end = Math.min(totalPages, start + windowSize - 1)
    const adjustedStart = Math.max(1, end - windowSize + 1)
    return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index)
  }, [currentPage, totalPages])

  const selectionSummary = useMemo(() => {
    const selectedSet = new Set(selectedKeys)
    let pdfCount = 0
    let hwpCount = 0
    let totalCredits = 0
    const selections: Array<{ itemId: string; assetKind: AssetKind }> = []

    for (const row of rows) {
      const hwpSelected = selectedSet.has(getSelectionKey(row.itemId, 'hwp')) && row.hwp.available && !row.hwp.owned

      if (!hwpSelected && selectedSet.has(getSelectionKey(row.itemId, 'pdf')) && row.pdf.available && !row.pdf.owned) {
        pdfCount += 1
        totalCredits += row.pdf.price
        selections.push({ itemId: row.itemId, assetKind: 'pdf' })
      }

      if (hwpSelected) {
        hwpCount += 1
        totalCredits += row.hwp.price
        selections.push({ itemId: row.itemId, assetKind: 'hwp' })
      }
    }

    return {
      pdfCount,
      hwpCount,
      totalCredits,
      totalCount: pdfCount + hwpCount,
      selections,
    }
  }, [rows, selectedKeys])

  const fetchBalance = async () => {
    const response = await fetch('/api/credits/balance', {
      cache: 'no-store',
      next: { revalidate: 0 },
    })

    if (!response.ok) {
      throw new Error('잔액 정보를 불러오지 못했습니다.')
    }

    const payload = await response.json()
    if (typeof payload.balance !== 'number') {
      throw new Error('잔액 정보 형식이 올바르지 않습니다.')
    }

    setCurrentBalance(payload.balance)
    window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: payload.balance } }))
  }

  const toggleSelection = (itemId: string, assetKind: AssetKind, checked: boolean) => {
    const key = getSelectionKey(itemId, assetKind)
    const counterpartKey = getSelectionKey(itemId, assetKind === 'pdf' ? 'hwp' : 'pdf')
    setSelectedKeys((current) => {
      const withoutCurrent = current.filter((value) => value !== key)
      const withoutCounterpart = checked ? withoutCurrent.filter((value) => value !== counterpartKey) : withoutCurrent
      return checked ? Array.from(new Set([...withoutCounterpart, key])) : withoutCounterpart
    })
  }

  const handlePurchaseClick = async () => {
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

    if (selectionSummary.totalCount === 0) {
      toast.error('구매할 파일을 먼저 선택해주세요.')
      return
    }

    setIsCheckingBalance(true)
    try {
      await fetchBalance()
      setShowConfirmation(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '크레딧 확인에 실패했습니다.')
    } finally {
      setIsCheckingBalance(false)
    }
  }

  const handleConfirmPurchase = () => {
    setShowConfirmation(false)
    startTransition(async () => {
      try {
        const response = await fetch('/api/market/purchases/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selections: selectionSummary.selections }),
        })
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || !payload.success) {
          throw new Error(getPurchaseErrorMessage(response.status, payload.error?.message))
        }

        if (typeof payload.balance === 'number') {
          setCurrentBalance(payload.balance)
          window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: payload.balance } }))
        }

        setSelectedKeys([])
        toast.success(payload.message || '선택한 파일 구매가 완료되었습니다.')
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '선택 파일 결제 중 오류가 발생했습니다.')
        router.refresh()
      }
    })
  }

  const renderAssetOption = (row: MarketListboardRow, assetKind: AssetKind, compact = false) => {
    const asset = assetKind === 'pdf' ? row.pdf : row.hwp
    const key = getSelectionKey(row.itemId, assetKind)
    const selected = selectedKeys.includes(key) && asset.available && !asset.owned
    const disabled = asset.owned || !asset.available || isPending || isCheckingBalance
    const stateLabel = getAssetStateLabel(asset, selected)
    const formatLabel = getAssetLabel(assetKind)

    if (asset.owned) {
      return (
        <div
          className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          aria-label={`${row.title} ${formatLabel} 보유`}
        >
          <span className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />{formatLabel}</span>
          <span>보유</span>
        </div>
      )
    }

    if (!asset.available) {
      return (
        <div
          className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400"
          aria-label={`${row.title} ${formatLabel} 미제공`}
        >
          <span className="flex items-center gap-2 font-semibold"><Lock className="h-4 w-4" />{formatLabel}</span>
          <span>미제공</span>
        </div>
      )
    }

    return (
      <button
        type="button"
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${selected ? 'border-slate-900 bg-slate-900 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'}`}
        disabled={disabled}
        aria-label={`${row.title} ${formatLabel} ${stateLabel}`}
        aria-pressed={selected}
        onClick={() => toggleSelection(row.itemId, assetKind, !selected)}
      >
        <span className="flex items-center gap-2 font-semibold">
          <Checkbox
            checked={selected}
            disabled={disabled}
            tabIndex={-1}
            aria-hidden="true"
            className={selected ? 'border-white data-[state=checked]:bg-white data-[state=checked]:text-slate-900' : undefined}
          />
          {formatLabel}
        </span>
        <span className={compact ? 'text-xs font-semibold' : 'font-semibold'}>{asset.price.toLocaleString()}C</span>
      </button>
    )
  }

  const renderRowBadges = (row: MarketListboardRow) => (
    <div className="flex flex-wrap gap-1.5">
      {row.sample.available ? (
        <Badge variant="secondary" className="rounded-full bg-blue-50 text-blue-700 hover:bg-blue-50">
          <Sparkles className="mr-1 h-3 w-3" />샘플 제공
        </Badge>
      ) : null}
      <Badge variant="outline" className="rounded-full">PDF · PDF & HWP</Badge>
    </div>
  )

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-slate-50/70 px-6 py-16 text-center">
        <FileText className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-4 font-semibold text-slate-800">검색 조건에 맞는 자료가 없습니다.</p>
        <p className="mt-2 text-sm text-slate-500">검색 조건을 초기화해보세요.</p>
        <Button asChild variant="outline" className="mt-5">
          <WorkspaceLink href={`/market/${categorySlug}`}>검색 조건 초기화</WorkspaceLink>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border md:block">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="w-[72px] px-4 py-3 text-center font-medium whitespace-nowrap">번호</th>
              <th className="min-w-[340px] px-4 py-3 text-left font-medium">자료명</th>
              <th className="w-[320px] px-4 py-3 text-left font-medium whitespace-nowrap">파일 선택</th>
              <th className="w-[120px] px-4 py-3 text-center font-medium whitespace-nowrap">조회</th>
              <th className="w-[140px] px-4 py-3 text-center font-medium whitespace-nowrap">게시일자</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row) => {
              const href = `/market/${categorySlug}/items/${row.itemId}`

              return (
                <tr key={row.itemId} className="border-t bg-white transition-colors hover:bg-slate-50">
                  <td className="px-4 py-5 text-center text-gray-600 whitespace-nowrap">{row.rowNumber}</td>
                  <td className="px-4 py-5 align-top">
                    <div className="space-y-2">
                      <WorkspaceLink href={href} className="block font-semibold text-slate-950 hover:text-slate-700">
                        {row.title}
                      </WorkspaceLink>
                      <div className="text-xs text-gray-500">{formatExamMeta(row)}</div>
                      {renderRowBadges(row)}
                    </div>
                  </td>
                  <td className="px-4 py-5 align-top">
                    <div className="grid gap-2 lg:grid-cols-2">
                      {renderAssetOption(row, 'pdf')}
                      {renderAssetOption(row, 'hwp')}
                    </div>
                  </td>
                  <td className="px-4 py-5 text-center text-gray-700 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5 text-slate-400" />{row.viewCount.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-5 text-center text-gray-700 whitespace-nowrap">{formatPublishedDate(row.publishedAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {pagedRows.map((row) => {
          const href = `/market/${categorySlug}/items/${row.itemId}`

          return (
            <article key={row.itemId} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="text-xs font-semibold text-slate-500">{row.rowNumber}번</div>
                  <WorkspaceLink href={href} className="block font-semibold leading-6 text-slate-950">
                    {row.title}
                  </WorkspaceLink>
                  <p className="text-xs text-slate-500">{formatExamMeta(row)}</p>
                </div>
                <div className="text-xs text-slate-500">조회 {row.viewCount.toLocaleString()}</div>
              </div>
              <div className="mt-3">{renderRowBadges(row)}</div>
              <div className="mt-4 grid gap-2">
                {renderAssetOption(row, 'pdf', true)}
                {renderAssetOption(row, 'hwp', true)}
              </div>
              <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-slate-500">
                <span>{formatPublishedDate(row.publishedAt)}</span>
                <WorkspaceLink href={href} className="font-medium text-slate-900">상세보기</WorkspaceLink>
              </div>
            </article>
          )
        })}
      </div>

      <div className="mt-4 space-y-4 pb-[env(safe-area-inset-bottom)]">
        <div className="grid gap-3 rounded-xl border bg-gray-50/70 px-4 py-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div className="hidden md:block" />
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-center justify-center gap-2">
              <Button type="button" variant="outline" size="icon-sm" disabled={currentPage === 1} onClick={() => setCurrentPage(1)} aria-label="첫 페이지">
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon-sm" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} aria-label="이전 페이지">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {visiblePageNumbers.map((pageNumber) => (
                <Button key={pageNumber} type="button" variant={pageNumber === currentPage ? 'default' : 'outline'} size="sm" onClick={() => setCurrentPage(pageNumber)} aria-label={`${pageNumber} 페이지`}>
                  {pageNumber}
                </Button>
              ))}
              <Button type="button" variant="outline" size="icon-sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} aria-label="다음 페이지">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon-sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)} aria-label="마지막 페이지">
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
            <label htmlFor="market-rows-per-page">표시 개수</label>
            <select
              id="market-rows-per-page"
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

        <div className="sticky bottom-3 z-10 flex justify-end md:static">
          <div className="w-full rounded-2xl border bg-white/95 p-4 shadow-lg backdrop-blur md:w-fit md:min-w-[420px] md:shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm text-gray-600">
                <p className="font-semibold text-gray-900">선택 {selectionSummary.totalCount}건</p>
                <p>PDF {selectionSummary.pdfCount}건 · PDF & HWP {selectionSummary.hwpCount}건</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs text-gray-500">총 결제 금액</p>
                <p className={`text-lg font-bold ${selectionSummary.totalCount > 0 ? 'text-slate-950' : 'text-gray-400'}`}>{selectionSummary.totalCredits.toLocaleString()} 크레딧</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={selectionSummary.totalCount === 0 || isPending || isCheckingBalance} onClick={() => setSelectedKeys([])}>
                선택 해제
              </Button>
              <Button disabled={selectionSummary.totalCount === 0 || isPending || isCheckingBalance} onClick={() => void handlePurchaseClick()}>
                {isPending ? '결제 처리 중...' : isCheckingBalance ? '잔액 확인 중...' : '선택 파일 결제'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <CreditConfirmationDialog
        open={showConfirmation}
        onClose={() => {
          if (isPending) {
            return
          }
          setShowConfirmation(false)
        }}
        onConfirm={handleConfirmPurchase}
        requiredAmount={selectionSummary.totalCredits}
        currentBalance={currentBalance}
        isLoading={isPending || isCheckingBalance}
        title="선택 파일 결제 확인"
        description={`PDF ${selectionSummary.pdfCount}건, PDF & HWP ${selectionSummary.hwpCount}건을 크레딧으로 구매합니다.`}
      />
    </>
  )
}
