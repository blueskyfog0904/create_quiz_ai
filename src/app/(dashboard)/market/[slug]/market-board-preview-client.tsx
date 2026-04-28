'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Eye, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { WorkspaceLink } from '@/components/layout/workspace-link'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'
import { useLoginRedirect } from '@/hooks/use-login-redirect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { MarketListboardRow } from '@/lib/market-items-server'

interface MarketBoardPreviewClientProps {
  categorySlug: string
  rows: MarketListboardRow[]
  isLoggedIn: boolean
}

type AssetKind = 'pdf' | 'hwp'
const ROWS_PER_PAGE = 15

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
  return assetKind === 'pdf' ? 'PDF' : 'HWP & PDF'
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

export default function MarketBoardPreviewClient({ categorySlug, rows, isLoggedIn }: MarketBoardPreviewClientProps) {
  const router = useRouter()
  const { redirectToLogin } = useLoginRedirect()
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE))

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE
    return rows.slice(start, start + ROWS_PER_PAGE)
  }, [currentPage, rows])

  const visiblePageNumbers = useMemo(() => {
    const windowSize = 10
    const start = Math.max(1, Math.floor((currentPage - 1) / windowSize) * windowSize + 1)
    const end = Math.min(totalPages, start + windowSize - 1)
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [currentPage, totalPages])

  const selectionSummary = useMemo(() => {
    const selectedSet = new Set(selectedKeys)
    let pdfCount = 0
    let hwpCount = 0
    let totalCredits = 0
    const selections: Array<{ itemId: string; assetKind: AssetKind }> = []

    for (const row of rows) {
      const hwpKey = getSelectionKey(row.itemId, 'hwp')
      const pdfKey = getSelectionKey(row.itemId, 'pdf')

      if (selectedSet.has(hwpKey) && row.hwp.available && !row.hwp.owned) {
        hwpCount += 1
        totalCredits += row.hwp.price
        selections.push({ itemId: row.itemId, assetKind: 'hwp' })
        continue
      }

      if (selectedSet.has(pdfKey) && row.pdf.available && !row.pdf.owned) {
        pdfCount += 1
        totalCredits += row.pdf.price
        selections.push({ itemId: row.itemId, assetKind: 'pdf' })
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

  const toggleSelection = (itemId: string, assetKind: AssetKind) => {
    const key = getSelectionKey(itemId, assetKind)
    const counterpartKey = getSelectionKey(itemId, assetKind === 'pdf' ? 'hwp' : 'pdf')

    setSelectedKeys((current) => {
      if (current.includes(key)) {
        return current.filter((value) => value !== key)
      }

      return [...current.filter((value) => value !== counterpartKey), key]
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

  const renderAssetChoice = (row: MarketListboardRow, assetKind: AssetKind) => {
    const asset = assetKind === 'pdf' ? row.pdf : row.hwp
    const key = getSelectionKey(row.itemId, assetKind)
    const checked = selectedKeys.includes(key) && asset.available && !asset.owned
    const label = getAssetLabel(assetKind)
    const disabled = asset.owned || !asset.available || isPending || isCheckingBalance

    if (asset.owned) {
      return (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700">
          {label} 보유
        </span>
      )
    }

    if (!asset.available) {
      return (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-400">
          {label} 미제공
        </span>
      )
    }

    return (
      <button
        type="button"
        className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${checked ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-500 hover:bg-slate-50'}`}
        disabled={disabled}
        aria-pressed={checked}
        aria-label={`${row.title} ${label} ${asset.price.toLocaleString()} 크레딧 선택`}
        onClick={() => toggleSelection(row.itemId, assetKind)}
      >
        <span className={`h-3.5 w-3.5 rounded-[4px] border ${checked ? 'border-white bg-white shadow-inner' : 'border-slate-300 bg-white'}`}>
          {checked ? <span className="block h-full w-full scale-50 rounded-[2px] bg-slate-950" /> : null}
        </span>
        <span className="whitespace-nowrap font-semibold">{label}</span>
        <span className={`whitespace-nowrap ${checked ? 'text-white/80' : 'text-slate-500'}`}>{asset.price.toLocaleString()}C</span>
      </button>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center">
        <FileText className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-4 font-semibold text-slate-800">검색 조건에 맞는 자료가 없습니다.</p>
        <p className="mt-2 text-sm text-slate-500">게시판형 디자인 테스트에서도 동일한 검색 결과를 사용합니다.</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl border bg-slate-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-slate-950">게시판형 디자인 테스트</p>
            <p className="text-xs text-slate-500">게시판형 목록에서 선택 후 결제까지 확인할 수 있는 테스트 페이지입니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Badge variant="secondary" className="rounded-full">선택 {selectionSummary.totalCount}건</Badge>
            <Badge variant="outline" className="rounded-full">PDF {selectionSummary.pdfCount}건</Badge>
            <Badge variant="outline" className="rounded-full">HWP & PDF {selectionSummary.hwpCount}건</Badge>
            <Badge className="rounded-full bg-slate-950 text-white hover:bg-slate-950">{selectionSummary.totalCredits.toLocaleString()}C</Badge>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[1080px] w-full border-collapse text-sm">
              <thead className="border-t-2 border-slate-950 bg-slate-50 text-slate-700">
                <tr className="border-b">
                  <th className="w-[74px] px-3 py-3 text-center text-sm font-bold">번호</th>
                  <th className="px-3 py-3 text-left text-sm font-bold">자료명</th>
                  <th className="min-w-[410px] px-3 py-3 text-center text-sm font-bold">파일</th>
                  <th className="w-[92px] px-3 py-3 text-center text-sm font-bold">조회</th>
                  <th className="w-[126px] px-3 py-3 text-center text-sm font-bold">날짜</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => {
                  const href = `/market/${categorySlug}/items/${row.itemId}`

                  return (
                    <tr key={row.itemId} className="border-b border-slate-200 bg-white transition hover:bg-slate-50/80">
                      <td className="px-3 py-2 text-center text-slate-500">{row.rowNumber}</td>
                      <td className="px-3 py-2">
                        <div className="flex min-w-0 items-center">
                          <WorkspaceLink href={href} className="truncate font-semibold text-slate-900 hover:text-slate-600">
                            {row.title}
                          </WorkspaceLink>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-nowrap items-center justify-center gap-2">
                          {renderAssetChoice(row, 'pdf')}
                          {renderAssetChoice(row, 'hwp')}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-600">
                        <span className="inline-flex items-center justify-center gap-1">
                          <Eye className="h-3.5 w-3.5 text-slate-400" />{row.viewCount.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-slate-600">{formatPublishedDate(row.publishedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 rounded-xl border bg-white px-4 py-3 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div className="text-center text-xs text-slate-500 md:text-left">
            총 {rows.length}건 · {currentPage}/{totalPages} 페이지
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5 justify-self-center">
            <Button type="button" variant="ghost" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(1)} aria-label="첫 페이지">
              첫 페이지
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} aria-label="이전 페이지">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {visiblePageNumbers.map((pageNumber) => (
              <Button key={pageNumber} type="button" variant={pageNumber === currentPage ? 'default' : 'ghost'} size="sm" onClick={() => setCurrentPage(pageNumber)} aria-label={`${pageNumber} 페이지`}>
                {pageNumber}
              </Button>
            ))}
            <Button type="button" variant="ghost" size="icon-sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} aria-label="다음 페이지">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)} aria-label="마지막 페이지">
              끝 페이지
            </Button>
          </div>
          <div className="hidden md:block" />
        </div>

        <div className="sticky bottom-3 z-10 flex justify-end md:static">
          <div className="w-full rounded-2xl border bg-white/95 p-4 shadow-lg backdrop-blur md:w-fit md:min-w-[420px] md:shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 text-sm text-gray-600">
                <p className="font-semibold text-gray-900">선택 {selectionSummary.totalCount}건</p>
                <p>PDF {selectionSummary.pdfCount}건 · HWP & PDF {selectionSummary.hwpCount}건</p>
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
        description={`PDF ${selectionSummary.pdfCount}건, HWP & PDF ${selectionSummary.hwpCount}건을 크레딧으로 구매합니다.`}
      />
    </>
  )
}
