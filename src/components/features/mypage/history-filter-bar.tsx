'use client'

import { useState } from 'react'
import { CalendarRange, FilterX, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { buildQuickRangeFilter } from '@/lib/mypage-history-filters'

export interface HistoryFilterOption {
  label: string
  value: string
}

export interface HistoryFilterBarValues {
  fromDate: string
  toDate: string
  categoryValue?: string
}

interface HistoryFilterBarProps {
  categoryLabel?: string
  categoryOptions?: HistoryFilterOption[]
  initialValues: HistoryFilterBarValues
  onApply: (values: HistoryFilterBarValues) => void
  resultCount: number
}

const DEFAULT_CATEGORY = 'all'
const QUICK_RANGES = [
  { label: '7일', days: 7 },
  { label: '1개월', days: 30 },
  { label: '6개월', days: 180 },
]

export function HistoryFilterBar({
  categoryLabel,
  categoryOptions = [],
  initialValues,
  onApply,
  resultCount,
}: HistoryFilterBarProps) {
  const [quickRangeValue, setQuickRangeValue] = useState('custom')
  const [draft, setDraft] = useState<HistoryFilterBarValues>({
    fromDate: initialValues.fromDate,
    toDate: initialValues.toDate,
    categoryValue: initialValues.categoryValue ?? DEFAULT_CATEGORY,
  })

  const handleApply = () => {
    onApply({
      fromDate: draft.fromDate,
      toDate: draft.toDate,
      categoryValue: draft.categoryValue ?? DEFAULT_CATEGORY,
    })
  }

  const handleReset = () => {
    const resetValues = {
      fromDate: '',
      toDate: '',
      categoryValue: DEFAULT_CATEGORY,
    }

    setQuickRangeValue('custom')
    setDraft(resetValues)
    onApply(resetValues)
  }

  const handleQuickRangeApply = (days: number) => {
    const nextValues = {
      ...buildQuickRangeFilter(days),
      categoryValue: draft.categoryValue ?? DEFAULT_CATEGORY,
    }

    setQuickRangeValue(String(days))
    setDraft(nextValues)
    onApply(nextValues)
  }

  return (
    <div className="mb-5 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div
          className={cn(
            'grid flex-1 gap-3 md:grid-cols-2',
            categoryLabel && categoryOptions.length > 0
              ? 'xl:grid-cols-[168px_168px_128px_220px]'
              : 'xl:grid-cols-[168px_168px_128px]'
          )}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              기간 시작
            </div>
            <Input
              type="date"
              className="w-full px-2 text-sm"
              value={draft.fromDate}
              onChange={(event) => {
                setQuickRangeValue('custom')
                setDraft((current) => ({ ...current, fromDate: event.target.value }))
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              기간 종료
            </div>
            <Input
              type="date"
              className="w-full px-2 text-sm"
              value={draft.toDate}
              onChange={(event) => {
                setQuickRangeValue('custom')
                setDraft((current) => ({ ...current, toDate: event.target.value }))
              }}
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-700">빠른 선택</div>
            <Select
              value={quickRangeValue}
              onValueChange={(value) => {
                if (value === 'custom') {
                  setQuickRangeValue(value)
                  return
                }

                handleQuickRangeApply(Number(value))
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="기간 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">직접 선택</SelectItem>
                {QUICK_RANGES.map((range) => (
                  <SelectItem key={range.label} value={String(range.days)}>
                    {range.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {categoryLabel && categoryOptions.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">{categoryLabel}</div>
              <Select
                value={draft.categoryValue ?? DEFAULT_CATEGORY}
                onValueChange={(value) => setDraft((current) => ({ ...current, categoryValue: value }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={`${categoryLabel} 선택`} />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="outline" onClick={handleReset} className="gap-2">
            <FilterX className="h-4 w-4" />
            초기화
          </Button>
          <Button onClick={handleApply} className="gap-2">
            <Search className="h-4 w-4" />
            검색
          </Button>
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        검색 결과 {resultCount.toLocaleString()}건
      </p>
    </div>
  )
}
