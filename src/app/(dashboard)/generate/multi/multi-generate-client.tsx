'use client'

import { useState, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from 'sonner'
import { BatchQuestionPreviewCard } from '@/components/features/quiz/batch-question-preview-card'
import { Database } from '@/types/supabase'
import { Question } from '@/lib/ai/types'
import { useRouter } from 'next/navigation'
import { AlertCircle, Plus, X, ChevronLeft, Loader2, BookOpen, FileText, Minus } from 'lucide-react'
import { PassageSelectorModal } from '@/components/features/passages/passage-selector-modal'
import { Passage } from '@/app/api/passages/actions'
import { Textarea } from '@/components/ui/textarea'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'
import { useLoginRedirect } from '@/hooks/use-login-redirect'
import type { WorkspaceSubject } from '../workspace-subject'

type ProblemType = Database['public']['Tables']['problem_types']['Row']

interface MultiGenerateClientProps {
  problemTypes: ProblemType[]
  workspaceSubject: WorkspaceSubject
  isLoggedIn: boolean
}

interface GeneratedQuestionData {
  question: Question
  rawResponse: string
  generationRunId?: string | null
  problemType: ProblemType
  tags: string[]
  rating: number
}

type RequestError = Error & {
  code?: string
  status?: number
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const toRequestError = (error: unknown, fallbackMessage = '문제 생성 중 오류가 발생했습니다'): RequestError => {
  if (error instanceof Error) {
    return error as RequestError
  }

  return new Error(fallbackMessage) as RequestError
}

export default function MultiGenerateClient({ problemTypes, workspaceSubject, isLoggedIn }: MultiGenerateClientProps) {
  const router = useRouter()
  const { redirectToLogin } = useLoginRedirect()
  const [passage, setPassage] = useState('')
  const [selectedPassage, setSelectedPassage] = useState<Passage | null>(null)
  
  // AbortController ref for cancelling generation
  const abortControllerRef = useRef<AbortController | null>(null)

  const [viewMode, setViewMode] = useState<'FORM' | 'RESULT'>('FORM')
  
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([])
  
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [generatedQuestions, setGeneratedQuestions] = useState<Map<string, GeneratedQuestionData>>(new Map())
  const [savedStates, setSavedStates] = useState<Map<string, boolean>>(new Map())
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
  const [showGenerationCompleteDialog, setShowGenerationCompleteDialog] = useState(false)
  const [generatingProgress, setGeneratingProgress] = useState({ current: 0, total: 0, currentType: '' })

  // Result View States
  const [scale, setScale] = useState(100)
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set())
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)

  // Helper to update specific question data
  const updateQuestionData = (typeId: string, updates: Partial<GeneratedQuestionData>) => {
    setGeneratedQuestions(prev => {
        const newMap = new Map(prev)
        const current = newMap.get(typeId)
        if (current) {
            newMap.set(typeId, { ...current, ...updates })
        }
        return newMap
    })
  }

  const handleTypeToggle = (typeId: string, checked: boolean) => {
    if (checked) {
      setSelectedTypeIds([...selectedTypeIds, typeId])
    } else {
      setSelectedTypeIds(selectedTypeIds.filter(id => id !== typeId))
    }
  }

  const handlePassageSelect = (p: Passage) => {
    setSelectedPassage(p)
    // Format content: replace single newlines with spaces to make sentences continuous,
    // but preserve double newlines (paragraphs) if needed.
    // The regex looks for a single newline surrounded by non-newlines and replaces it with a space.
    const formattedContent = p.content.replace(/([^\n])\n([^\n])/g, '$1 $2')
    setPassage(formattedContent)
    setIsSelectorOpen(false)
    toast.success('지문이 선택되었습니다')
  }



  // Confirmation States
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [showCancellationResult, setShowCancellationResult] = useState(false)
  const [cancellationResultMessage, setCancellationResultMessage] = useState<ReactNode>('')
  const [isNavigatingToGeneratedAfterCancel, setIsNavigatingToGeneratedAfterCancel] = useState(false)
  const isGenerationBusy = isGenerating || isCancelling
  const CREDIT_COST_PER_QUESTION = 100
  const totalRemainingMinutes = Math.max(generatingProgress.total - generatedQuestions.size, 0)
  const hasGeneratedQuestions = generatedQuestions.size > 0

  const buildCancellationMessage = (totalCount: number, completedCount: number) => {
    const usedCredit = completedCount * CREDIT_COST_PER_QUESTION
    return (
      <span>
        취소되었습니다.
        <br />
        <span className="font-bold">{totalCount}개의 문제 생성</span> 중{' '}
        <span className="font-bold text-red-600">{completedCount}개</span>가 생성 완료되었습니다.
        <br />
        <span className="font-bold text-red-600">{usedCredit} 크레딧</span>이 최종 사용되었습니다.
      </span>
    )
  }

  // 1. Validation & Balance Check
  const handleGenerateClick = async (e: React.FormEvent) => {
    if (isGenerationBusy) return

    e.preventDefault()

    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

    if (selectedTypeIds.length === 0) {
      toast.error("최소 1개 이상의 문제 유형을 선택해주세요")
      return
    }

    if (!passage) {
      toast.error("지문을 선택하거나 등록해주세요")
      return
    }

    setIsCheckingBalance(true)
    try {
      const res = await fetch('/api/credits/balance', {
        cache: 'no-store',
        next: { revalidate: 0 }
      })
      if (!res.ok) throw new Error('Failed to fetch balance')
      const data = await res.json()
      setCurrentBalance(data.balance)
      notifyHeaderBalance(data.balance)
      setShowConfirmation(true)
    } catch (error) {
       console.error(error)
       toast.error('잔액 정보를 불러오는데 실패했습니다.')
    } finally {
      setIsCheckingBalance(false)
    }
  }

  const notifyHeaderBalance = (balance: number) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('credit-balance-updated', {
        detail: { balance }
      })
    )
  }

  const syncHeaderCreditBalance = async ({
    attempts = 1,
    delayMs = 250
  }: { attempts?: number; delayMs?: number } = {}) => {
    if (typeof window === 'undefined') return

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const balanceRes = await fetch('/api/credits/balance', {
          cache: 'no-store',
          next: { revalidate: 0 }
        })
        if (!balanceRes.ok) continue

        const data = await balanceRes.json()
        if (typeof data.balance === 'number') {
          notifyHeaderBalance(data.balance)
        }
      } catch {
        // Ignore sync failures
      }

      if (attempt < attempts - 1) {
        await sleep(delayMs * (attempt + 1))
      }
    }
  }

  const syncHeaderCreditBalanceFromResponse = async (response: Response) => {
    const rawBalance = response.headers.get('x-credit-balance')
    const updatedBalance = rawBalance === null ? null : Number(rawBalance)

    if (updatedBalance !== null && Number.isFinite(updatedBalance)) {
      notifyHeaderBalance(updatedBalance)
      return
    }
    await syncHeaderCreditBalance()
  }

  const sleepWithAbort = (ms: number, signal: AbortSignal) => {
    return new Promise<void>((resolve, reject) => {
      let onAbort: () => void = () => {}

      const timeoutId = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)

      onAbort = () => {
        clearTimeout(timeoutId)
        signal.removeEventListener('abort', onAbort)
        reject(new Error('Generation cancelled'))
      }

      signal.addEventListener('abort', onAbort)
    })
  }

  const getErrorCode = (error: unknown): string | undefined => {
    if (!error || typeof error !== 'object') return undefined
    const candidate = error as { code?: unknown }
    return typeof candidate.code === 'string' ? candidate.code : undefined
  }

  const shouldSyncOnError = (error: unknown) => {
    const code = getErrorCode(error)
    const status = (error as { status?: number }).status
    const isCancelled = code === 'GENERATION_CANCELLED' || (error instanceof Error && (error.name === 'AbortError' || error.message === 'Generation cancelled'))
    return (
      isCancelled ||
      code === 'AI_ERROR' ||
      code === 'INTERNAL_SERVER_ERROR' ||
      status === 408 ||
      (status !== undefined && status >= 500) ||
      status === undefined
    )
  }

  const syncHeaderCreditBalanceAndRefresh = async () => {
    await syncHeaderCreditBalance({
      attempts: 10,
      delayMs: 250
    })
  }

  // 2. Actual Generation Logic
  const handleConfirmGeneration = async () => {
    setIsConfirming(true)
    setShowConfirmation(false)
    setShowCancellationResult(false)
    setCancellationResultMessage('')
    setIsNavigatingToGeneratedAfterCancel(false)

    // Create new AbortController
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setIsGenerating(true)
    setGeneratedQuestions(new Map())
    setSavedStates(new Map())
    setGeneratingProgress({ current: 0, total: selectedTypeIds.length, currentType: '' })
    setShowGenerationCompleteDialog(false)
    let shouldSyncHeader = false
    let successCount = 0
    let failCount = 0
    const generatedTypeIds: string[] = []

    try {
      // 각 문제 유형에 대해 순차적으로 API 호출 (rate limit 방지)
      for (let i = 0; i < selectedTypeIds.length; i++) {
        // Check if aborted before starting next iteration
        if (signal.aborted) {
            throw new Error('Generation cancelled')
        }

        const typeId = selectedTypeIds[i]
        const problemType = problemTypes.find(pt => pt.id === typeId)
        
        // 진행 상황 업데이트
        setGeneratingProgress({ 
          current: i + 1, 
          total: selectedTypeIds.length, 
          currentType: problemType?.type_name || '' 
        })
        
        try {
          // 첫 번째 요청이 아닌 경우 1초 대기 (rate limit 방지)
          if (i > 0) {
            await sleepWithAbort(1000, signal)
          }

          const res = await fetch('/api/questions/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              passage,
              problemTypeId: typeId,
              workspaceSubject,
              generationSource: 'multi',
            }),
            signal // Pass the abort signal
          })

          await syncHeaderCreditBalanceFromResponse(res)
          const data = await res.json()

          if (!res.ok || !data.success) {
            const error: RequestError = new Error(data.error?.message || "문제 생성에 실패했습니다")
            error.code = data.error?.code
            error.status = res.status

            throw error
          }
          
          // 성공한 결과를 즉시 화면에 표시
          setGeneratedQuestions(prev => {
            const newMap = new Map(prev)
            newMap.set(typeId, {
              question: data.data,
              rawResponse: data.rawAiResponse,
              generationRunId: data.generationRunId,
              problemType: problemType!,
              tags: selectedPassage?.tags || [], // Inherit tags from passage
              rating: 0
            })
            return newMap
          })
          generatedTypeIds.push(typeId)

          toast.success(`"${problemType?.type_name}" 문제가 생성되었습니다 (${i + 1}/${selectedTypeIds.length})`)
          successCount++

        } catch (error: unknown) {
          const requestError = toRequestError(error)
          const isCancelled =
            requestError.name === 'AbortError' ||
            requestError.message === 'Generation cancelled' ||
            requestError.code === 'GENERATION_CANCELLED'

          if (shouldSyncOnError(requestError)) {
            shouldSyncHeader = true
          }

          if (isCancelled || (requestError.status ?? 0) >= 500) {
            if (isCancelling) {
              setCancellationResultMessage(
                buildCancellationMessage(selectedTypeIds.length, successCount)
              )
              setShowCancellationResult(true)
            }
            throw requestError
          }

          console.error(`Failed to generate question for type ${typeId}:`, requestError)
          const problemType = problemTypes.find(pt => pt.id === typeId)
          toast.error(`"${problemType?.type_name}" 문제 생성 실패: ${requestError.message}`)
          failCount++
        }
      }

      if (successCount > 0 && failCount > 0) {
        toast.info(`${successCount}개 생성 완료, ${failCount}개 실패`)
        setSelectedResultIds(new Set(generatedTypeIds))
        setShowGenerationCompleteDialog(true)
        router.refresh()
      } else if (successCount > 0) {
        toast.success(`모든 문제가 생성되었습니다! (${successCount}개)`)
        setSelectedResultIds(new Set(generatedTypeIds))
        setShowGenerationCompleteDialog(true)
        router.refresh()
      } else if (failCount === selectedTypeIds.length) {
        toast.error("모든 문제 생성에 실패했습니다. 다시 시도해주세요.")
      }

    } catch (error: unknown) {
      const requestError = toRequestError(error)
      const isCancelled =
        requestError.name === 'AbortError' ||
        requestError.message === 'Generation cancelled' ||
        requestError.code === 'GENERATION_CANCELLED'
      const status = requestError.status

      if (isCancelled) {
            shouldSyncHeader = true
            setCancellationResultMessage(
              buildCancellationMessage(selectedTypeIds.length, successCount)
            )
            setShowCancellationResult(true)
        } else {
            console.error(requestError)
            toast.error("문제 생성 중 오류가 발생했습니다")
            if (status === undefined || status >= 500 || requestError.code === 'AI_ERROR' || requestError.code === 'INTERNAL_SERVER_ERROR') {
              shouldSyncHeader = true
            }
        }
      if (shouldSyncHeader) {
        if (isCancelled) {
          void syncHeaderCreditBalanceAndRefresh()
        } else {
          void syncHeaderCreditBalance({
            attempts: 1,
            delayMs: 250
          })
        }
      }
    } finally {
      setIsConfirming(false)
      setIsGenerating(false)
      setIsCancelling(false)
      abortControllerRef.current = null
    }
  }

  const handleCancelGeneration = () => {
    if (!abortControllerRef.current || isCancelling) return

    setIsCancelling(true)
    setIsGenerating(false)
    const controller = abortControllerRef.current
    controller.abort()
    abortControllerRef.current = null
    void syncHeaderCreditBalanceAndRefresh()
    // State cleanup handled in catch/finally block of handleGenerate
  }

  const handleSaveIndividual = async (typeId: string) => {
    const questionData = generatedQuestions.get(typeId)
    if (!questionData) return
    
    // Optimistic UI update
    setSavedStates(new Map(savedStates.set(typeId, true)))

    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: questionData.question,
          passage,
          problemTypeId: typeId,
          rawAiResponse: questionData.rawResponse,
          generationRunId: questionData.generationRunId,
          passageId: selectedPassage?.id,
          workspaceSubject,
        })
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "문제 저장에 실패했습니다")
      }

      toast.success(`"${questionData.problemType.type_name}" 문제가 저장되었습니다`)
      
    } catch (error: unknown) {
      toast.error(toRequestError(error, '문제 저장에 실패했습니다').message)
      setSavedStates(new Map(savedStates.set(typeId, false))) // Revert
    }
  }

  /* Individual save logic (removed duplicate) */

  const handleSaveAll = async () => {
    if (selectedResultIds.size === 0) {
        toast.info("저장할 문제를 선택해주세요")
        return
    }

    const unsavedQuestions = Array.from(generatedQuestions.entries())
        .filter(([typeId]) => selectedResultIds.has(typeId)) // Only selected ones
        .filter(([typeId]) => !savedStates.get(typeId)) // Skip already saved logic? Or allow overwrite? 
    
    if (unsavedQuestions.length === 0) {
       // Check if there are selected items that are already saved
       const selectedCount = selectedResultIds.size;
       const savedSelectedCount = Array.from(selectedResultIds).filter(id => savedStates.get(id)).length;
       
       if (selectedCount === savedSelectedCount) {
           toast.info("선택한 문제가 이미 모두 저장되었습니다")
           return
       }
    }

    setIsSaving(true)

    try {
      let successCount = 0
      let failCount = 0

      for (const [typeId, questionData] of Array.from(generatedQuestions.entries())) {
          // Only process selected items
          if (!selectedResultIds.has(typeId)) continue;
          if (savedStates.get(typeId)) continue; // Skip already saved for now

        try {
          const res = await fetch('/api/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: questionData.question,
              passage,
              problemTypeId: typeId,
              rawAiResponse: questionData.rawResponse,
              generationRunId: questionData.generationRunId,
              passageId: selectedPassage?.id,
              tags: questionData.tags,    // Send tags
              rating: questionData.rating, // Send rating
              workspaceSubject,
            })
          })

          const data = await res.json()

          if (!res.ok || !data.success) {
            throw new Error(data.error?.message || "문제 저장에 실패했습니다")
          }

          setSavedStates(prev => new Map(prev.set(typeId, true)))
          successCount++
        } catch (error: unknown) {
          console.error(`Failed to save question for type ${typeId}:`, error)
          failCount++
        }
      }

      if (successCount > 0) {
        toast.success(`${successCount}개의 문제가 저장되었습니다!`)
        setShowSuccessDialog(true)
      }

      if (failCount > 0) {
        toast.error(`${failCount}개의 문제 저장에 실패했습니다`)
      }

    } catch {
      toast.error("문제 저장 중 오류가 발생했습니다")
    } finally {
      setIsSaving(false)
    }
  }

  const handleContinueGeneration = () => {
    setShowSuccessDialog(false)
    setGeneratedQuestions(new Map())
    setSavedStates(new Map())
    setViewMode('FORM')
    // Do not clear passage/type selection for faster re-generation if desired, 
    // or clear if user wants fresh start. Let's keep passage but clear results.
    // User can change passage if they want.
  }

  const handleGenerationCompleteConfirm = () => {
    setShowGenerationCompleteDialog(false)
    if (generatedQuestions.size === 0) {
      return
    }
    setViewMode('RESULT')
  }

  const handleGoToExamPaper = () => {
    router.push('/library/purchased')
  }

  const handleCancellationResultConfirm = () => {
    if (!hasGeneratedQuestions) {
      setShowCancellationResult(false)
      return
    }

    setIsNavigatingToGeneratedAfterCancel(true)
    window.setTimeout(() => {
      setShowCancellationResult(false)
      setIsNavigatingToGeneratedAfterCancel(false)
      setViewMode('RESULT')
      setSelectedResultIds(new Set(generatedQuestions.keys()))
    }, 700)
  }

  return (
    <div className={`${viewMode === 'RESULT' ? 'max-w-[1700px]' : 'max-w-5xl'} mx-auto space-y-8`}>
      {/* Input Form */}
      <div className="space-y-6">
      {viewMode === 'FORM' && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="text-xl font-semibold mb-4">문제 생성 옵션</h2>
              
              <form onSubmit={handleGenerateClick} className="space-y-4">
                
                {/* Passage Selection Section */}
                <div className="space-y-3">
                    <Label className="text-base font-semibold">
                      지문 선택 <span className="text-red-500">*</span>
                    </Label>
                    
                    <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 gap-2 h-12"
                          onClick={() => {
                            if (!isLoggedIn) {
                              redirectToLogin()
                              return
                            }
                            setIsSelectorOpen(true)
                          }}
                          disabled={isGenerationBusy}
                        >
                            <BookOpen className="w-4 h-4" />
                            내 영어지문 불러오기
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 gap-2 h-12"
                          onClick={() => {
                            if (!isLoggedIn) {
                              redirectToLogin()
                              return
                            }
                            router.push('/library/mypassages')
                          }}
                          disabled={isGenerationBusy}
                        >
                            <Plus className="w-4 h-4" />
                            영어지문 등록하기
                        </Button>
                    </div>

                    <div className="mt-4 space-y-2">
                        {passage || selectedPassage ? (
                            <>
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm font-medium text-gray-500">
                                        지문 내용 (직접 수정 가능)
                                    </Label>
                                    {selectedPassage && (
                                        <Badge variant="secondary" className="text-xs font-normal">
                                            불러온 지문: {selectedPassage.title_ko || selectedPassage.title_en || '제목 없음'}
                                        </Badge>
                                    )}
                                </div>
                                <Textarea 
                                    value={passage}
                                    onChange={(e) => setPassage(e.target.value)}
                                    placeholder="지문을 불러오거나 여기에 직접 입력하세요."
                                    className="min-h-[300px] text-base leading-relaxed p-4 font-serif resize-y focus:ring-primary/20"
                                />
                                <p className="text-xs text-gray-400 text-right">
                                    {passage.length}자
                                </p>
                            </>
                        ) : (
                             <div className="mt-2 p-12 border-2 border-dashed rounded-lg text-center text-gray-400 bg-gray-50/50 flex flex-col items-center justify-center gap-2">
                                <FileText className="w-8 h-8 opacity-50 mb-2" />
                                <p className="text-sm font-medium">지문을 선택하면 이곳에 내용이 표시됩니다</p>
                                <p className="text-xs text-gray-400">위 버튼을 클릭하여 지문을 불러오거나 등록해주세요</p>
                            </div>
                        )}
                    </div>
                </div>

                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle>문제 유형 선택</CardTitle>
                        <p className="text-sm text-gray-500">생성할 문제 유형을 복수 선택할 수 있습니다.</p>
                      </div>
                      <Button
                        type="button"
                        variant={selectedTypeIds.length === problemTypes.length ? 'outline' : 'default'}
                        size="sm"
                        className="h-8 text-xs"
                        disabled={isGenerationBusy || problemTypes.length === 0}
                        onClick={() => {
                          if (selectedTypeIds.length === problemTypes.length) {
                            setSelectedTypeIds([])
                          } else {
                            setSelectedTypeIds(problemTypes.map((pt) => pt.id))
                          }
                        }}
                      >
                        {selectedTypeIds.length === problemTypes.length ? '전체 해제' : '전체 선택'}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {problemTypes.length === 0 ? (
                      <div className="rounded-lg border border-dashed py-12 text-center text-gray-500">
                        등록된 문제 유형이 없습니다
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {problemTypes.map((type) => (
                          <label key={type.id} className="flex cursor-pointer gap-3 rounded-xl border p-4 transition hover:border-primary">
                            <Checkbox
                              id={type.id}
                              checked={selectedTypeIds.includes(type.id)}
                              onCheckedChange={(checked) => handleTypeToggle(type.id, checked as boolean)}
                              disabled={isGenerationBusy}
                              className="mt-1"
                            />
                            <div className="space-y-1">
                              <span className="text-sm font-medium leading-none text-gray-900">
                                {type.type_name}
                              </span>
                              {type.description && (
                                <p className="text-xs text-gray-500 line-clamp-2">
                                  {type.description}
                                </p>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Button 
                  type="submit" 
                  className="w-full text-lg h-12 mt-4" 
                  disabled={isGenerationBusy || isCheckingBalance || (isLoggedIn && (selectedTypeIds.length === 0 || !passage))}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      문제 생성 중...
                    </>
                  ) : isCheckingBalance ? (
                    '잔액 확인 중...'
                  ) : (
                    `문제 생성 시작 (예상 비용: ${(selectedTypeIds.length * 100).toLocaleString()} 크레딧)`
                  )}
                </Button>

                </form>
              </CardContent>
            </Card>
      )}

      <CreditConfirmationDialog
        open={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirmGeneration}
        requiredAmount={selectedTypeIds.length * 100}
        currentBalance={currentBalance}
        isLoading={isConfirming || isCheckingBalance || isCancelling}
      />
      </div>


      {generatedQuestions.size > 0 && viewMode === 'FORM' && (
         <div className="fixed bottom-8 right-8 z-50 animate-in fade-in slide-in-from-bottom-4">
             <Button 
                onClick={() => setViewMode('RESULT')}
                size="lg"
                className="shadow-xl"
             >
                생성된 문제 보기 ({generatedQuestions.size})
             </Button>
         </div>
      )}

      {viewMode === 'RESULT' && (
        <div className="space-y-6 pb-24">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
               <Button 
                variant="ghost" 
                onClick={() => setViewMode('FORM')}
                className="gap-2 pl-2"
                >
                <ChevronLeft className="w-5 h-5" />
                문제 생성 옵션으로 돌아가기
                </Button>
            </div>
            
             {/* Saved Indicator logic could go here or inside Cards */}
          </div>

           {/* Floating Action Bar (Sticky Top) */}
           <div className="sticky top-4 z-50 bg-background/80 backdrop-blur-md border rounded-xl shadow-sm p-4 mb-6 flex items-center justify-between transition-all duration-200">
                <div className="flex items-center gap-4">
                    <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => {
                            if (selectedResultIds.size === generatedQuestions.size) {
                                setSelectedResultIds(new Set())
                            } else {
                                setSelectedResultIds(new Set(generatedQuestions.keys()))
                            }
                        }}
                    >
                        {selectedResultIds.size === generatedQuestions.size ? '전체 해제' : '전체 선택'}
                    </Button>
                    <span className="text-xs text-gray-600">
                        {selectedResultIds.size}개 선택됨
                    </span>

                    {/* Zoom Slider Control */}
                    <div className="flex items-center gap-2 ml-3 pl-3 border-l">
                        <span className="text-xs font-medium w-12 text-center">{scale}%</span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full"
                            onClick={() => setScale(Math.max(50, scale - 10))}
                            disabled={scale <= 50}
                        >
                            <Minus className="h-3 w-3" />
                        </Button>

                        <input
                            type="range"
                            min="50"
                            max="150"
                            step="10"
                            value={scale}
                            onChange={(e) => setScale(Number(e.target.value))}
                            className="w-24 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
                        />

                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full"
                            onClick={() => setScale(Math.min(150, scale + 10))}
                            disabled={scale >= 150}
                        >
                            <Plus className="h-3 w-3" />
                        </Button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                     <Button 
                        onClick={handleSaveAll} // Logic updated to use selectedResultIds
                        disabled={isGenerating || selectedResultIds.size === 0}
                        className="bg-primary text-white"
                     >
                        선택한 {selectedResultIds.size}개 문제 저장
                     </Button>
                </div>
           </div>


          <div 
             className="grid gap-6 grid-cols-1 transition-transform duration-200 origin-top-left"
             style={{
                transform: `scale(${scale / 100})`,
                width: `${100 / (scale / 100)}%`,
                marginBottom: `${((scale / 100) - 1) * 100}%` // compensate spacing
             }}
           > 
            {Array.from(generatedQuestions.entries()).map(([typeId, questionData]) => (
              <BatchQuestionPreviewCard
                key={typeId}
                questionNumber={questionData.problemType.type_name}
                problemTypeName=""
                generatedQuestion={{
                  questionText: questionData.question.questionText,
                  questionTextForward: questionData.question.questionTextForward ?? null,
                  questionTextBackward: questionData.question.questionTextBackward ?? null,
                  passageText: questionData.question.passageText ?? null,
                  choices: questionData.question.choices,
                  answer: questionData.question.answer,
                  explanation: questionData.question.explanation ?? null,
                }}
                rating={questionData.rating}
                tags={questionData.tags}
                isSelected={selectedResultIds.has(typeId)}
                saveStatus={savedStates.get(typeId) ? 'saved' : 'unsaved'}
                isSaving={isSaving}
                onRatingChange={(rating) => updateQuestionData(typeId, { rating })}
                onAddTag={(tag) => {
                  const nextTag = tag.trim()
                  if (!nextTag) return
                  if (questionData.tags.includes(nextTag)) {
                    toast.error('이미 존재하는 태그입니다')
                    return
                  }
                  updateQuestionData(typeId, { tags: [...questionData.tags, nextTag] })
                }}
                onRemoveTag={(tag) => updateQuestionData(typeId, { tags: questionData.tags.filter((currentTag) => currentTag !== tag) })}
                onSelectChange={(checked) => {
                  const newSet = new Set(selectedResultIds)
                  if (checked) newSet.add(typeId)
                  else newSet.delete(typeId)
                  setSelectedResultIds(newSet)
                }}
                onSave={() => void handleSaveIndividual(typeId)}
              />
            ))}
          </div>

          
        </div>
      )}

      {/* Success Dialog */}
      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문제가 저장되었습니다</DialogTitle>
            <DialogDescription>
              다음 단계를 선택해주세요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={handleContinueGeneration}>
              문제 계속 만들기
            </Button>
            <Button onClick={handleGoToExamPaper}>
              생성한 문제 확인하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showGenerationCompleteDialog}
        onOpenChange={(open) => {
          if (open) {
            setShowGenerationCompleteDialog(true)
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>문제 생성이 완료되었습니다.</DialogTitle>
            <DialogDescription>
              생성된 문제로 이동하시려면 <strong>확인</strong> 버튼을 눌러주세요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-center">
            <Button
              onClick={handleGenerationCompleteConfirm}
              className="w-full sm:w-auto"
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PassageSelectorModal
        open={isSelectorOpen}
        onOpenChange={setIsSelectorOpen}
        onSelect={handlePassageSelect}
      />

      {/* Progress Modal - Generating */}
       <Dialog open={isGenerating} onOpenChange={() => {}}>
            <DialogContent className="sm:max-w-md" showCloseButton={false}>
                <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                    <DialogTitle className="text-lg font-medium text-center mb-2">
                        AI가 문제를 생성 중에 있습니다
                    </DialogTitle>
                    <DialogDescription className="text-center mb-6">
                        잠시만 기다려주세요...{' '}
                        <span className="inline-flex items-center text-sm font-semibold text-primary ml-1">
                          (예상 남은 시간 {totalRemainingMinutes}분)
                        </span>
                    </DialogDescription>
                    
                    {generatingProgress.total > 0 && (
                        <div className="w-full space-y-3 px-4">
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">진행 상황</span>
                                <span className="font-medium text-primary">
                                    {generatingProgress.current} / {generatingProgress.total}
                                </span>
                            </div>
                            
                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                <div 
                                    className="bg-primary h-2.5 rounded-full transition-all duration-300"
                                    style={{ width: `${(generatingProgress.current / generatingProgress.total) * 100}%` }}
                                />
                            </div>
                            
                            {generatingProgress.currentType && (
                                <div className="text-gray-500 mt-2 text-center space-y-1">
                                    <p>
                                        현재 생성 중: <span className="font-medium text-gray-700">{generatingProgress.currentType}</span>
                                    </p>
                                    {generatedQuestions.size > 0 && (
                                      <div className="text-sm text-center">
                                        완료한 문제 유형
                                        <div className="mt-1 flex flex-col text-center">
                                          {Array.from(generatedQuestions.values()).map((questionData) => (
                                            <span key={questionData.problemType.id} className="text-blue-600">
                                              {questionData.problemType.type_name}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <DialogFooter className="justify-center">
                    <Button
                      variant="ghost"
                      disabled={isCancelling}
                      onClick={handleCancelGeneration}
                      className="w-full sm:w-auto text-red-500 hover:text-red-600 hover:bg-red-50"
                    >
                        <X className="w-4 h-4 mr-2" />
                        {isCancelling ? '취소 중...' : '취소'}
                    </Button>
                </DialogFooter>
            </DialogContent>
          </Dialog>

      {/* Progress Modal - Saving */}
       <Dialog open={isSaving} onOpenChange={() => {}}>
            <DialogContent className="sm:max-w-md" showCloseButton={false}>
                <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                    <DialogTitle className="text-lg font-medium text-center mb-2">
                        선택한 문제를 저장 중입니다
                    </DialogTitle>
                    <DialogDescription className="text-center mb-6">
                        잠시만 기다려주세요...
                    </DialogDescription>
                </div>
            </DialogContent>
          </Dialog>

      <Dialog
        open={showCancellationResult}
        onOpenChange={(open) => {
          if (!open) return
          setShowCancellationResult(open)
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <AlertCircle className="h-6 w-6" />
            </div>
            <DialogTitle className="text-center">취소 안내</DialogTitle>
            <DialogDescription className="text-center leading-relaxed">
              {cancellationResultMessage}
              {isNavigatingToGeneratedAfterCancel && (
                <p className="mt-2 text-sm font-semibold text-primary">
                  생성된 문제로 이동합니다.
                </p>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-center">
            <Button
              onClick={handleCancellationResultConfirm}
              className="w-full sm:w-auto"
              disabled={isNavigatingToGeneratedAfterCancel}
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
