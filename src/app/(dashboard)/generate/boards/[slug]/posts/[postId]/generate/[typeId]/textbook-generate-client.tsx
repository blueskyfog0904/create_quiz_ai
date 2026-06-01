'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, ArrowLeft, BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuestionPreview } from '@/components/features/quiz/question-preview'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'
import { useLoginRedirect } from '@/hooks/use-login-redirect'
import type { Database } from '@/types/supabase'
import type { Question } from '@/lib/ai/types'
import type { WorkspaceSubject } from '../../../../../../workspace-subject'

type ProblemType = Database['public']['Tables']['problem_types']['Row']
type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']
type GenerateMenuEntry = Database['public']['Tables']['generate_menu_entries']['Row']

interface TextbookGenerateClientProps {
  board: GenerateMenuEntry
  post: GenerateListboardPost
  problemType: ProblemType
  workspaceSubject: WorkspaceSubject
  isLoggedIn: boolean
}

interface GeneratedQuestionData {
  question: Question
  rawResponse: string
}

export default function TextbookGenerateClient({
  board,
  post,
  problemType,
  workspaceSubject,
  isLoggedIn,
}: TextbookGenerateClientProps) {
  const router = useRouter()
  const { redirectToLogin } = useLoginRedirect()
  const abortControllerRef = useRef<AbortController | null>(null)
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [generatedQuestion, setGeneratedQuestion] = useState<GeneratedQuestionData | null>(null)
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [showSavedDialog, setShowSavedDialog] = useState(false)

  const passage = useMemo(() => post.passage_text, [post.passage_text])

  const fetchBalance = async () => {
    const res = await fetch('/api/credits/balance', {
      cache: 'no-store',
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      throw new Error('잔액 정보를 불러오는데 실패했습니다.')
    }

    const data = await res.json()
    if (typeof data.balance === 'number') {
      setCurrentBalance(data.balance)
      window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: data.balance } }))
    }
  }

  const handleGenerateClick = async () => {
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

    if (!passage) {
      toast.error('지문 정보가 없습니다.')
      return
    }

    setIsCheckingBalance(true)
    try {
      await fetchBalance()
      setShowConfirmation(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '잔액 확인에 실패했습니다.')
    } finally {
      setIsCheckingBalance(false)
    }
  }

  const handleConfirmGeneration = async () => {
    setShowConfirmation(false)
    setIsConfirming(true)
    setIsGenerating(true)
    abortControllerRef.current = new AbortController()

    try {
      const res = await fetch('/api/questions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passage,
          problemTypeId: problemType.id,
          workspaceSubject,
        }),
        signal: abortControllerRef.current.signal,
      })

      const nextBalance = res.headers.get('x-credit-balance')
      if (nextBalance) {
        const numericBalance = Number(nextBalance)
        if (Number.isFinite(numericBalance)) {
          setCurrentBalance(numericBalance)
          window.dispatchEvent(new CustomEvent('credit-balance-updated', { detail: { balance: numericBalance } }))
        }
      }

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '문제 생성에 실패했습니다.')
      }

      setGeneratedQuestion({
        question: data.data,
        rawResponse: data.rawAiResponse,
      })
      setShowCompleteDialog(true)
      toast.success('교재형 문제가 생성되었습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제 생성 중 오류가 발생했습니다.')
    } finally {
      setIsConfirming(false)
      setIsGenerating(false)
      abortControllerRef.current = null
    }
  }

  const handleSave = async () => {
    if (!generatedQuestion) return

    setIsSaving(true)
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: generatedQuestion.question,
          passage,
          problemTypeId: problemType.id,
          rawAiResponse: generatedQuestion.rawResponse,
          tags: [],
          rating: 0,
          workspaceSubject,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '문제 저장에 실패했습니다.')
      }

      setShowSavedDialog(true)
      toast.success('문제은행에 저장했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제 저장 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancelGeneration = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsGenerating(false)
    setIsConfirming(false)
    toast.info('문제 생성을 취소했습니다.')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{problemType.type_name}</h1>
          <p className="mt-2 text-gray-500">{board.title} 지문을 사용해 교재형 문제를 생성합니다.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/generate/boards/${board.slug}/posts/${post.id}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />문제 유형 다시 선택
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" />선택한 지문</CardTitle>
          <CardDescription>
            {post.title} · {post.exam_year ?? '-'} / {post.exam_month ? `${post.exam_month}월` : '-'} / {post.grade_level ?? '-'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea value={passage} readOnly className="min-h-[280px] resize-none bg-gray-50 leading-7" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>문제 생성 옵션</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">          <Button onClick={handleGenerateClick} disabled={isCheckingBalance || isGenerating} className="w-full text-base h-11">
            {isCheckingBalance ? '잔액 확인 중...' : isGenerating ? '문제 생성 중...' : '교재형 문제 생성 시작 (100 크레딧)'}
          </Button>
        </CardContent>
      </Card>

      {generatedQuestion ? (
        <QuestionPreview
          question={generatedQuestion.question}
          onSave={handleSave}
          isSaving={isSaving}
          title="생성 결과"
        />
      ) : null}

      <CreditConfirmationDialog
        open={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirmGeneration}
        requiredAmount={100}
        currentBalance={currentBalance}
        isLoading={isConfirming || isCheckingBalance}
        title="교재형 문제 생성 확인"
        description="선택한 지문으로 AI 문제를 생성합니다."
      />

      <Dialog open={isGenerating} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>AI가 문제를 생성 중입니다</DialogTitle>
            <DialogDescription>잠시만 기다려주세요.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelGeneration}>취소</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문제 생성이 완료되었습니다.</DialogTitle>
            <DialogDescription>아래 미리보기에서 저장 여부를 선택할 수 있습니다.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowCompleteDialog(false)}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSavedDialog} onOpenChange={setShowSavedDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문제를 저장했습니다.</DialogTitle>
            <DialogDescription>문제은행 또는 이전 화면으로 이동할 수 있습니다.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSavedDialog(false)}>계속 보기</Button>
            <Button onClick={() => router.push('/library/purchased')}>영어문제 관리로 이동</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
