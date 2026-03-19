'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { MarketListboardRow } from '@/lib/market-items-server'

interface MarketListboardClientProps {
  categorySlug: string
  rows: MarketListboardRow[]
}

type AssetKind = 'pdf' | 'hwp'

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

export default function MarketListboardClient({ categorySlug, rows }: MarketListboardClientProps) {
  const router = useRouter()
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [isPending, startTransition] = useTransition()

  const selectionSummary = useMemo(() => {
    const selectedSet = new Set(selectedKeys)
    let pdfCount = 0
    let hwpCount = 0
    let totalCredits = 0
    const selections: Array<{ itemId: string; assetKind: AssetKind }> = []

    for (const row of rows) {
      if (selectedSet.has(getSelectionKey(row.itemId, 'pdf')) && row.pdf.available && !row.pdf.owned) {
        pdfCount += 1
        totalCredits += row.pdf.price
        selections.push({ itemId: row.itemId, assetKind: 'pdf' })
      }

      if (selectedSet.has(getSelectionKey(row.itemId, 'hwp')) && row.hwp.available && !row.hwp.owned) {
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
    setSelectedKeys((current) => checked
      ? [...current, key]
      : current.filter((value) => value !== key))
  }

  const handlePurchaseClick = async () => {
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
        const payload = await response.json()

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message || '선택 파일 결제에 실패했습니다.')
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
      }
    })
  }

  const renderAssetCell = (row: MarketListboardRow, assetKind: AssetKind) => {
    const asset = assetKind === 'pdf' ? row.pdf : row.hwp
    const key = getSelectionKey(row.itemId, assetKind)
    const checked = asset.owned || selectedKeys.includes(key)
    const disabled = asset.owned || !asset.available || isPending || isCheckingBalance

    return (
      <div className="flex items-center justify-center gap-2">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => toggleSelection(row.itemId, assetKind, value === true)}
          aria-label={`${row.title} ${assetKind.toUpperCase()} 선택`}
        />
        <div className="min-w-[72px] text-left">
          {asset.owned ? (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">보유</Badge>
          ) : !asset.available ? (
            <Badge variant="secondary">없음</Badge>
          ) : (
            <span className="text-xs font-medium text-gray-700">{asset.price.toLocaleString()}C</span>
          )}
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-gray-500">
        검색 조건에 맞는 자료가 없습니다.
      </div>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="w-[72px] px-4 py-3 font-medium whitespace-nowrap">번호</th>
              <th className="min-w-[320px] px-4 py-3 font-medium">제목</th>
              <th className="w-[120px] px-4 py-3 text-center font-medium whitespace-nowrap">PDF</th>
              <th className="w-[120px] px-4 py-3 text-center font-medium whitespace-nowrap">HWP</th>
              <th className="w-[100px] px-4 py-3 text-right font-medium whitespace-nowrap">조회</th>
              <th className="w-[140px] px-4 py-3 text-right font-medium whitespace-nowrap">게시일자</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = `/market/${categorySlug}/items/${row.itemId}`

              return (
                <tr key={row.itemId} className="border-t transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.rowNumber}</td>
                  <td className="px-4 py-3 align-top">
                    <Link href={href} className="block space-y-1">
                      <div className="font-medium text-gray-900">{row.title}</div>
                      <div className="text-xs text-gray-500">
                        {row.examYear ?? '-'} / {row.examMonth ? `${row.examMonth}월` : '-'} / {row.gradeLevel ?? '-'}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">{renderAssetCell(row, 'pdf')}</td>
                  <td className="px-4 py-3">{renderAssetCell(row, 'hwp')}</td>
                  <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">{row.viewCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-700 whitespace-nowrap">{formatPublishedDate(row.publishedAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <div className="flex w-full max-w-4xl flex-col gap-3 rounded-2xl border bg-white/95 px-4 py-3 shadow-lg backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <span className="font-medium text-gray-900">선택 {selectionSummary.totalCount}건</span>
            <span>PDF {selectionSummary.pdfCount}건</span>
            <span>HWP {selectionSummary.hwpCount}건</span>
            <span className="font-semibold text-rose-600">총 {selectionSummary.totalCredits.toLocaleString()} 크레딧</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              disabled={selectionSummary.totalCount === 0 || isPending || isCheckingBalance}
              onClick={() => setSelectedKeys([])}
            >
              선택 해제
            </Button>
            <Button
              disabled={selectionSummary.totalCount === 0 || isPending || isCheckingBalance}
              onClick={() => void handlePurchaseClick()}
            >
              {isPending ? '결제 처리 중...' : isCheckingBalance ? '잔액 확인 중...' : '선택 파일 결제'}
            </Button>
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
        description={`PDF ${selectionSummary.pdfCount}건, HWP ${selectionSummary.hwpCount}건을 크레딧으로 구매합니다.`}
      />
    </>
  )
}
