'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  MAX_RANDOM_EXAM_QUESTION_COUNT,
  getMaxCountForProblemType,
  normalizeAvailabilityRows,
  validateRandomExamRequest,
  type QuestionBankAvailability,
  type QuestionBankBook,
  type QuestionBankYear,
  type RandomExamTypeCount,
} from '@/lib/question-bank/random-exam'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

type ProblemType = {
  id: string
  type_name: string
  is_active?: boolean | null
}

interface RandomExamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  problemTypes: ProblemType[]
  workspaceSubject: WorkspaceSubject
}

function getResponseMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== 'object') {
    return fallback
  }

  const body = data as { message?: unknown; error?: unknown }

  return typeof body.message === 'string'
    ? body.message
    : typeof body.error === 'string'
      ? body.error
      : fallback
}

export function RandomExamDialog({
  open,
  onOpenChange,
  problemTypes,
  workspaceSubject,
}: RandomExamDialogProps) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [years, setYears] = useState<QuestionBankYear[]>([])
  const [books, setBooks] = useState<QuestionBankBook[]>([])
  const [optionProblemTypes, setOptionProblemTypes] = useState<ProblemType[]>([])
  const [selectedYearId, setSelectedYearId] = useState('')
  const [selectedBookId, setSelectedBookId] = useState('')
  const [availability, setAvailability] = useState<QuestionBankAvailability[]>([])
  const [typeCounts, setTypeCounts] = useState<RandomExamTypeCount[]>([])
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)

  const activeProblemTypes = useMemo(() => {
    const bankProblemTypes = optionProblemTypes.length > 0 ? optionProblemTypes : problemTypes

    return bankProblemTypes.filter((problemType) => problemType.is_active !== false)
  }, [optionProblemTypes, problemTypes])

  const positiveTypeCounts = useMemo(
    () => typeCounts.filter((typeCount) => typeCount.count > 0),
    [typeCounts]
  )

  const totalSelectedCount = useMemo(
    () => positiveTypeCounts.reduce((sum, typeCount) => sum + typeCount.count, 0),
    [positiveTypeCounts]
  )

  const validation = useMemo(() => validateRandomExamRequest({
    title,
    typeCounts: positiveTypeCounts,
    availability,
  }), [title, positiveTypeCounts, availability])

  const canSubmit = Boolean(
    title.trim() &&
    selectedYearId &&
    selectedBookId &&
    totalSelectedCount > 0 &&
    validation.isValid &&
    !isSubmitting &&
    !isLoadingOptions &&
    !isLoadingAvailability
  )

  useEffect(() => {
    if (!open) {
      return
    }

    let isCancelled = false

    const fetchOptions = async () => {
      setIsLoadingOptions(true)
      setOptionsError(null)
      setYears([])
      setBooks([])
      setOptionProblemTypes([])

      try {
        const optionsParams = new URLSearchParams()
        optionsParams.set('subject', workspaceSubject)
        const optionsResponse = await fetch(`/api/question-bank/options?${optionsParams.toString()}`)
        const data = await optionsResponse.json().catch(() => ({}))

        if (!optionsResponse.ok) {
          throw new Error(getResponseMessage(data, '문제은행 옵션을 불러오지 못했습니다.'))
        }

        if (!isCancelled) {
          setYears(Array.isArray(data.years) ? data.years : [])
          setBooks(Array.isArray(data.books) ? data.books : [])
          setOptionProblemTypes(Array.isArray(data.problemTypes) ? data.problemTypes : [])
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '문제은행 옵션을 불러오지 못했습니다.'

        if (!isCancelled) {
          setOptionsError(message)
          toast.error(message)
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingOptions(false)
        }
      }
    }

    fetchOptions()

    return () => {
      isCancelled = true
    }
  }, [open, workspaceSubject])

  useEffect(() => {
    if (!open || !selectedYearId || !selectedBookId) {
      setAvailability([])
      setTypeCounts([])
      setAvailabilityError(null)
      return
    }

    let isCancelled = false

    const fetchAvailability = async () => {
      setIsLoadingAvailability(true)
      setAvailabilityError(null)
      setAvailability([])
      setTypeCounts([])

      try {
        const availabilityParams = new URLSearchParams()
        availabilityParams.set('subject', workspaceSubject)
        availabilityParams.set('yearId', selectedYearId)
        availabilityParams.set('bookId', selectedBookId)
        const availabilityResponse = await fetch(`/api/question-bank/availability?${availabilityParams.toString()}`)
        const data = await availabilityResponse.json().catch(() => ({}))

        if (!availabilityResponse.ok) {
          throw new Error(getResponseMessage(data, '사용 가능한 문항 수를 불러오지 못했습니다.'))
        }

        if (!isCancelled) {
          setAvailability(normalizeAvailabilityRows(data.availability))
          setTypeCounts([])
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '사용 가능한 문항 수를 불러오지 못했습니다.'

        if (!isCancelled) {
          setAvailability([])
          setTypeCounts([])
          setAvailabilityError(message)
          toast.error(message)
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingAvailability(false)
        }
      }
    }

    fetchAvailability()

    return () => {
      isCancelled = true
    }
  }, [open, selectedYearId, selectedBookId, workspaceSubject])

  const getCurrentCount = (problemTypeId: string) => {
    return typeCounts.find((typeCount) => typeCount.problemTypeId === problemTypeId)?.count ?? 0
  }

  const setCountForType = (problemTypeId: string, requestedCount: number) => {
    const maxCount = getMaxCountForProblemType(availability, problemTypeId)
    const currentCount = getCurrentCount(problemTypeId)
    const otherCount = totalSelectedCount - currentCount
    const remainingLimit = Math.max(0, MAX_RANDOM_EXAM_QUESTION_COUNT - otherCount)
    const nextCount = Math.min(
      Math.max(0, Math.floor(Number.isFinite(requestedCount) ? requestedCount : 0)),
      maxCount,
      remainingLimit
    )

    setTypeCounts((prev) => {
      const withoutCurrent = prev.filter((typeCount) => typeCount.problemTypeId !== problemTypeId)

      if (nextCount === 0) {
        return withoutCurrent
      }

      return [...withoutCurrent, { problemTypeId, count: nextCount }]
    })
  }

  const handleSubmit = async () => {
    const submitTypeCounts = typeCounts.filter((typeCount) => typeCount.count > 0)
    const submitValidation = validateRandomExamRequest({
      title,
      typeCounts: submitTypeCounts,
      availability,
    })

    if (!selectedYearId || !selectedBookId || !submitValidation.isValid) {
      toast.error(submitValidation.errors[0]?.message ?? '랜덤 문제지 생성 조건을 확인해주세요.')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/exam-papers/random-bank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          yearId: selectedYearId,
          bookId: selectedBookId,
          typeCounts: submitTypeCounts,
          workspaceSubject,
        }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok || data.success === false) {
        throw new Error(getResponseMessage(data, '랜덤 문제지 생성에 실패했습니다.'))
      }

      toast.success('랜덤 문제지가 생성되었습니다.')
      onOpenChange(false)
      setTitle('')
      setSelectedYearId('')
      setSelectedBookId('')
      setAvailability([])
      setTypeCounts([])
      setOptionProblemTypes([])
      router.push(`/library/exam-papers/${data.examPaperId}?subject=${workspaceSubject}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '랜덤 문제지 생성에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>랜덤 문제지 생성</DialogTitle>
          <DialogDescription>
            연도와 교재 범위를 선택한 뒤 문제 유형별 문항 수를 지정해 문제지를 생성합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="random-exam-title">문제지 제목 *</Label>
            <Input
              id="random-exam-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 2025 수능특강 랜덤 30문항"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>연도 *</Label>
              <Select value={selectedYearId} onValueChange={setSelectedYearId} disabled={isLoadingOptions}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="연도 선택" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.label || year.year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>교재 *</Label>
              <Select value={selectedBookId} onValueChange={setSelectedBookId} disabled={isLoadingOptions}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="교재 선택" />
                </SelectTrigger>
                <SelectContent>
                  {books.map((book) => (
                    <SelectItem key={book.id} value={book.id}>
                      {book.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoadingOptions ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              문제은행 옵션을 불러오는 중입니다...
            </p>
          ) : null}
          {optionsError ? <p className="text-sm text-red-600">{optionsError}</p> : null}

          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">문제 유형별 문항 수</h3>
                <p className="mt-1 text-xs text-gray-500">
                  전체 최대 {MAX_RANDOM_EXAM_QUESTION_COUNT}문항까지 선택할 수 있습니다.
                </p>
              </div>
              <Badge variant="outline">선택 {totalSelectedCount}문항</Badge>
            </div>

            {!selectedYearId || !selectedBookId ? (
              <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-500">
                연도와 교재를 선택하면 유형별 사용 가능 문항 수가 표시됩니다.
              </p>
            ) : null}

            {isLoadingAvailability ? (
              <p className="flex items-center gap-2 rounded-md bg-gray-50 p-3 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                사용 가능한 문항 수를 불러오는 중입니다...
              </p>
            ) : null}

            {availabilityError ? <p className="text-sm text-red-600">{availabilityError}</p> : null}

            {selectedYearId && selectedBookId && !isLoadingAvailability ? (
              <div className="space-y-2">
                {activeProblemTypes.map((problemType) => {
                  const availableCount = getMaxCountForProblemType(availability, problemType.id)
                  const maxCount = availableCount
                  const count = getCurrentCount(problemType.id)
                  const disabled = availableCount === 0

                  return (
                    <div key={problemType.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">{problemType.type_name}</p>
                        <p className="mt-1 text-xs text-gray-500">최대 {availableCount}문항</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={`${problemType.type_name} 감소`}
                          disabled={disabled || count === 0}
                          onClick={() => setCountForType(problemType.id, count - 1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <Input
                          type="number"
                          min={0}
                          max={maxCount}
                          value={count}
                          disabled={disabled}
                          onChange={(event) => setCountForType(problemType.id, Number(event.target.value))}
                          className="h-8 w-20 text-center"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={`${problemType.type_name} 증가`}
                          disabled={disabled || count >= maxCount || totalSelectedCount >= MAX_RANDOM_EXAM_QUESTION_COUNT}
                          onClick={() => setCountForType(problemType.id, count + 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>

          {!validation.isValid && totalSelectedCount > 0 ? (
            <p className="text-sm text-red-600">{validation.errors[0]?.message}</p>
          ) : null}
        </div>

        <DialogFooter className="justify-center gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSubmitting ? '생성 중...' : '랜덤 문제지 생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
