'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'
import type { Database } from '@/types/supabase'

type ProblemType = Database['public']['Tables']['problem_types']['Row']
type GenerateMenuEntry = Database['public']['Tables']['generate_menu_entries']['Row']
type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']
type GenerateListboardPostItem = Database['public']['Tables']['generate_listboard_post_items']['Row']

interface BoardPostClientProps {
  board: GenerateMenuEntry
  post: GenerateListboardPost
  items: GenerateListboardPostItem[]
  problemTypes: ProblemType[]
}

const CREDIT_COST_PER_GENERATION = 100
const GRADE_OPTIONS = ['1학년', '2학년', '3학년'] as const
const DIFFICULTY_OPTIONS = [
  { value: 'Low', label: '하' },
  { value: 'Medium', label: '중' },
  { value: 'High', label: '상' },
] as const

export default function BoardPostClient({
  board,
  post,
  items,
  problemTypes,
}: BoardPostClientProps) {
  const router = useRouter()
  const [selectedProblemTypeIds, setSelectedProblemTypeIds] = useState<string[]>([])
  const [selectedPostItemIds, setSelectedPostItemIds] = useState<string[]>([])
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [gradeLevel, setGradeLevel] = useState(post.grade_level || '1학년')
  const [difficulty, setDifficulty] = useState('Medium')

  const selectedItems = useMemo(
    () => items.filter((item) => selectedPostItemIds.includes(item.id)),
    [items, selectedPostItemIds]
  )
  const requestedGenerationCount = selectedProblemTypeIds.length * selectedPostItemIds.length
  const requiredCredits = requestedGenerationCount * CREDIT_COST_PER_GENERATION

  const renderBatchStartCard = () => (
    <Card>
      <CardHeader>
        <CardTitle>배치 생성 시작</CardTitle>
        <CardDescription>
          선택된 문제 유형 {selectedProblemTypeIds.length}개 × 문항 {selectedPostItemIds.length}개 = 총 {requestedGenerationCount}건 생성
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedItems.length > 0 ? (
          <div className="rounded-lg border bg-gray-50 px-4 py-3 text-sm text-gray-600">
            선택 문항: {selectedItems.slice(0, 8).map((item) => item.question_number).join(', ')}
            {selectedItems.length > 8 ? ' ...' : ''}
          </div>
        ) : null}
        <Button
          onClick={handleStartClick}
          disabled={isCheckingBalance || isSubmitting || requestedGenerationCount === 0}
          className="w-full h-11 text-base"
        >
          {isCheckingBalance ? '크레딧 확인 중...' : isSubmitting ? '작업 생성 중...' : `배치 생성 시작 (${requiredCredits.toLocaleString()} 크레딧)`}
        </Button>
      </CardContent>
    </Card>
  )

  const toggleProblemType = (typeId: string, checked: boolean) => {
    setSelectedProblemTypeIds((current) => checked
      ? [...current, typeId]
      : current.filter((id) => id !== typeId))
  }

  const togglePostItem = (itemId: string, checked: boolean) => {
    setSelectedPostItemIds((current) => checked
      ? [...current, itemId]
      : current.filter((id) => id !== itemId))
  }

  const fetchBalance = async () => {
    const res = await fetch('/api/credits/balance', {
      cache: 'no-store',
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      throw new Error('잔액 정보를 불러오지 못했습니다.')
    }

    const data = await res.json()
    if (typeof data.balance === 'number') {
      setCurrentBalance(data.balance)
      window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: data.balance } }))
    }
  }

  const handleStartClick = async () => {
    if (selectedProblemTypeIds.length === 0) {
      toast.error('최소 1개 이상의 문제 유형을 선택해주세요.')
      return
    }

    if (selectedPostItemIds.length === 0) {
      toast.error('최소 1개 이상의 문항을 선택해주세요.')
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

  const handleConfirm = async () => {
    setShowConfirmation(false)
    setIsSubmitting(true)

    try {
      const res = await fetch('/api/generate/listboard-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId: post.id,
          postItemIds: selectedPostItemIds,
          problemTypeIds: selectedProblemTypeIds,
          gradeLevel,
          difficulty,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '배치 생성 작업 생성에 실패했습니다.')
      }

      toast.success('배치 생성 작업을 등록했습니다.')
      const params = new URLSearchParams({
        gradeLevel,
        difficulty,
      })
      router.push(`/generate/boards/${board.slug}/posts/${post.id}/jobs/${data.data.jobId}?${params.toString()}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '배치 생성 작업 생성 중 오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{post.title}</h1>
          <p className="mt-2 text-gray-500">문제 유형과 문항을 선택한 뒤 배치 생성 작업을 시작할 수 있습니다.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/generate/boards/${board.slug}`}>목록으로 돌아가기</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>게시글 정보</CardTitle>
          <CardDescription>
            {post.exam_year ?? '-'} / {post.exam_month ? `${post.exam_month}월` : '-'} / {post.grade_level ?? '-'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-gray-700 md:grid-cols-4">
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">선택된 문제 유형</p>
            <p className="mt-1 text-lg font-semibold">{selectedProblemTypeIds.length}개</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">선택된 문항</p>
            <p className="mt-1 text-lg font-semibold">{selectedPostItemIds.length}개</p>
          </div>
          <div className="rounded-md border border-sky-100 bg-sky-50/80 px-4 py-3">
            <p className="text-xs text-gray-500">총 생성 건수</p>
            <p className="mt-1 text-lg font-semibold text-sky-700">{requestedGenerationCount}건</p>
          </div>
          <div className="rounded-md border border-rose-100 bg-rose-50/80 px-4 py-3">
            <p className="text-xs text-gray-500">예상 차감 크레딧</p>
            <p className="mt-1 text-lg font-semibold text-rose-700">{requiredCredits.toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>생성 옵션</CardTitle>
          <CardDescription>선택한 모든 문제 유형/문항 조합에 동일한 옵션이 적용됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="grade-level">학년</Label>
            <Select value={gradeLevel} onValueChange={setGradeLevel}>
              <SelectTrigger id="grade-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRADE_OPTIONS.map((grade) => (
                  <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="difficulty">난이도</Label>
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger id="difficulty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIFFICULTY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI 문제 유형 선택</CardTitle>
          <CardDescription>생성할 문제 유형을 복수 선택할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {problemTypes.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-gray-500">활성화된 문제 유형이 없습니다.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {problemTypes.map((type) => (
                <label key={type.id} className="flex cursor-pointer gap-3 rounded-xl border p-4 transition hover:border-primary">
                  <Checkbox
                    checked={selectedProblemTypeIds.includes(type.id)}
                    onCheckedChange={(checked) => toggleProblemType(type.id, checked === true)}
                    className="mt-1"
                  />
                  <div className="space-y-1">
                    <div className="font-medium text-gray-900">{type.type_name}</div>
                    {type.description ? <p className="text-sm text-gray-500">{type.description}</p> : null}
                  </div>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {renderBatchStartCard()}

      <Card>
        <CardHeader>
          <CardTitle>문항 선택</CardTitle>
          <CardDescription>업로드된 문항 중 생성할 대상을 복수 선택할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-gray-500">등록된 문항이 없습니다.</div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <label key={item.id} className="flex cursor-pointer gap-3 rounded-xl border p-4 transition hover:border-primary">
                  <Checkbox
                    checked={selectedPostItemIds.includes(item.id)}
                    onCheckedChange={(checked) => togglePostItem(item.id, checked === true)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{item.question_number}번</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-700">{item.passage_text}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {renderBatchStartCard()}

      <CreditConfirmationDialog
        open={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirm}
        requiredAmount={requiredCredits}
        currentBalance={currentBalance}
        isLoading={isSubmitting || isCheckingBalance}
        title="배치 생성 확인"
        description={`학년 ${gradeLevel}, 난이도 ${DIFFICULTY_OPTIONS.find((option) => option.value === difficulty)?.label ?? difficulty} 기준으로 총 ${requestedGenerationCount}건의 생성 작업을 실행합니다.`}
      />
    </div>
  )
}
