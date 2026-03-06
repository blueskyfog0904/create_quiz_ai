'use client'

import { useState, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from 'sonner'
import { QuestionPreview } from '@/components/features/quiz/question-preview'
import { Database } from '@/types/supabase'
import { Question } from '@/lib/ai/types'
import { useRouter } from 'next/navigation'
import { AlertCircle, Star, Tag, Plus, X, ChevronLeft, Loader2, BookOpen, FileText, CheckCircle2, Minus, Maximize, ZoomIn } from 'lucide-react'
import { PassageSelectorModal } from '@/components/features/passages/passage-selector-modal'
import { Passage } from '@/app/api/passages/actions'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'

type ProblemType = Database['public']['Tables']['problem_types']['Row']

interface GenerateClientProps {
  problemType: ProblemType
}

interface GeneratedQuestionData {
  question: Question
  rawResponse: string
  problemType: ProblemType
  tags: string[]
  rating: number
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default function GenerateClient({ problemType }: GenerateClientProps) {
  const router = useRouter()
  const [passage, setPassage] = useState('')
  const [selectedPassage, setSelectedPassage] = useState<Passage | null>(null)
  
  // AbortController ref for cancelling generation
  const abortControllerRef = useRef<AbortController | null>(null)

  const [viewMode, setViewMode] = useState<'FORM' | 'RESULT'>('FORM')
  
  const [gradeLevel, setGradeLevel] = useState('High1')
  const [difficulty, setDifficulty] = useState('Medium')
  
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [generatedQuestion, setGeneratedQuestion] = useState<GeneratedQuestionData | null>(null)
  const [isSaved, setIsSaved] = useState(false)
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
  const [showGenerationCompleteDialog, setShowGenerationCompleteDialog] = useState(false)
  
  // Result View States
  const [scale, setScale] = useState(100)
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)

  // Use a map to mimic multi-gen for compatibility if we want to expand,
  // but simpler state is fine. Let's stick to simple state but use similar rendering logic.

  const handlePassageSelect = (p: Passage) => {
    setSelectedPassage(p)
    const formattedContent = p.content.replace(/([^\n])\n([^\n])/g, '$1 $2')
    setPassage(formattedContent)
    setIsSelectorOpen(false)
    toast.success('지문이 선택되었습니다')
  }

  // Confirmation Dialog States
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [showCancellationResult, setShowCancellationResult] = useState(false)
  const [cancellationResultMessage, setCancellationResultMessage] = useState<ReactNode>('')
  const CANCELLED_SINGLE_REFUND_CREDITS = 100
  const isGenerationBusy = isGenerating || isCancelling
  const singleExpectedRemainingMinutes = isGenerating ? 1 : 0

  // 1. Validation & Balance Check
  const handleGenerateClick = async (e: React.FormEvent) => {
    if (isGenerationBusy) return

    e.preventDefault()
    
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

  const extractHeaderBalance = (response: Response): number | null => {
    const rawBalance = response.headers.get('x-credit-balance')
    if (rawBalance === null) return null

    const parsedBalance = Number(rawBalance)
    return Number.isFinite(parsedBalance) ? parsedBalance : null
  }

  const syncHeaderCreditBalanceFromResponse = async (response: Response) => {
    const updatedBalance = extractHeaderBalance(response)
    if (updatedBalance !== null) {
      notifyHeaderBalance(updatedBalance)
      return
    }
    await syncHeaderCreditBalance()
  }

  const getErrorCode = (error: unknown): string | undefined => {
    if (!error || typeof error !== 'object') return undefined
    const candidate = error as { code?: unknown }
    return typeof candidate.code === 'string' ? candidate.code : undefined
  }

  const toErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message
    return '문제가 발생했습니다'
  }

  const syncHeaderCreditBalanceAndRefresh = async () => {
    await syncHeaderCreditBalance({
      attempts: 10,
      delayMs: 250
    })
  }

  // 2. Actual Generation Execution
  const handleConfirmGeneration = async () => {
    setIsConfirming(true)
    setShowConfirmation(false)
    setShowCancellationResult(false)
    setCancellationResultMessage('')
    setShowGenerationCompleteDialog(false)
    
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setIsGenerating(true)
    setGeneratedQuestion(null)
    setIsSaved(false)

    try {
      const res = await fetch('/api/questions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passage,
          gradeLevel,
          difficulty,
          problemTypeId: problemType.id
        }),
        signal
      })

      await syncHeaderCreditBalanceFromResponse(res)

      const data = await res.json()

      if (!res.ok || !data.success) {
        const error = new Error(data.error?.message || '문제 생성에 실패했습니다') as Error & {
          code?: string
        }
        ;(error as unknown as { status?: number }).status = res.status
        error.code = getErrorCode(data.error)
        throw error
      }
      
      setGeneratedQuestion({
        question: data.data,
        rawResponse: data.rawAiResponse,
        problemType: problemType,
        tags: selectedPassage?.tags || [],
        rating: 0
      })

      toast.success("문제가 생성되었습니다!")
      setShowGenerationCompleteDialog(true)

    } catch (error: unknown) {
      const isCancelled =
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.message === 'Generation cancelled')
      const errorCode = getErrorCode(error)
      const status = (error as unknown as { status?: number }).status
      const isCancelledByServer =
        errorCode === 'GENERATION_CANCELLED' ||
        status === 408
      const isServerMessageCancelled =
        error instanceof Error && error.message.includes('중단되었습니다.')
      const isUserCancelled = isCancelling || isCancelled || isCancelledByServer || isServerMessageCancelled
      const shouldHandleSync =
        isCancelled ||
        errorCode === 'GENERATION_CANCELLED' ||
        errorCode === 'AI_ERROR' ||
        errorCode === 'INTERNAL_SERVER_ERROR' ||
        status === 408 ||
        status === 500 ||
        status === undefined

      if (shouldHandleSync) {
        void syncHeaderCreditBalanceAndRefresh()
        if (isUserCancelled) {
          setCancellationResultMessage(
            <span>
              <span className="font-bold text-red-600">취소</span>되었습니다.
              <br />
              <span className="font-bold text-red-600">{CANCELLED_SINGLE_REFUND_CREDITS} 크레딧</span>이 반환되었습니다.
            </span>
          )
          setShowCancellationResult(true)
        }
      } else {
        console.error(error)
        toast.error(`문제 생성 중 오류가 발생했습니다: ${toErrorMessage(error)}`)
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
  }

  const handleSave = async () => {
    if (!generatedQuestion) return
    if (isSaved) {
        toast.info('이미 저장된 문제입니다')
        return
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: generatedQuestion.question,
          passage,
          gradeLevel,
          difficulty,
          problemTypeId: problemType.id,
          rawAiResponse: generatedQuestion.rawResponse,
          passageId: selectedPassage?.id,
          tags: generatedQuestion.tags,
          rating: generatedQuestion.rating
        })
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "문제 저장에 실패했습니다")
      }

      setIsSaved(true)
      toast.success("문제가 저장되었습니다")
      setShowSuccessDialog(true)

    } catch (error: unknown) {
      toast.error(toErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  const handleContinueGeneration = () => {
    setShowSuccessDialog(false)
    setGeneratedQuestion(null)
    setIsSaved(false)
    setViewMode('FORM')
    // Keep passage for convenience
  }

  const handleGoToExamPaper = () => {
    router.push('/library/purchased')
  }

  const handleGenerationCompleteConfirm = () => {
    setShowGenerationCompleteDialog(false)
    setViewMode('RESULT')
  }

  // Helper to update local question data (tags, rating)
  const updateQuestionData = (updates: Partial<GeneratedQuestionData>) => {
      if (!generatedQuestion) return
      setGeneratedQuestion({ ...generatedQuestion, ...updates })
  }

  return (
    <div className={`${viewMode === 'RESULT' ? 'max-w-[1700px] w-full' : 'max-w-5xl'} mx-auto space-y-8`}>
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
                          onClick={() => setIsSelectorOpen(true)}
                          disabled={isGenerationBusy}
                        >
                            <BookOpen className="w-4 h-4" />
                            내 영어지문 불러오기
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 gap-2 h-12"
                          onClick={() => router.push('/library/mypassages')}
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

                <div className="border-t my-4" />

                {/* Grade and Difficulty */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="grade">학년</Label>
                    <Select value={gradeLevel} onValueChange={setGradeLevel} disabled={isGenerationBusy}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Middle1">중1</SelectItem>
                        <SelectItem value="Middle2">중2</SelectItem>
                        <SelectItem value="Middle3">중3</SelectItem>
                        <SelectItem value="High1">고1</SelectItem>
                        <SelectItem value="High2">고2</SelectItem>
                        <SelectItem value="High3">고3</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="difficulty">난이도</Label>
                    <Select value={difficulty} onValueChange={setDifficulty} disabled={isGenerationBusy}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Low">하</SelectItem>
                        <SelectItem value="Medium">중</SelectItem>
                        <SelectItem value="High">상</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full text-lg h-12 mt-4" 
                  disabled={isGenerationBusy || !passage || isCheckingBalance}
                >
                  {isCancelling
                    ? '중단 처리 중...'
                    : isGenerating
                      ? '문제 생성 중...'
                      : isCheckingBalance
                        ? '잔액 확인 중...'
                        : '문제 생성 시작 (100 크레딧)'}
                </Button>

              </form>
            </CardContent>
          </Card>
      )}

      <CreditConfirmationDialog
        open={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        onConfirm={handleConfirmGeneration}
        requiredAmount={100} // Hardcoded for single generation
        currentBalance={currentBalance}
        isLoading={isConfirming || isCheckingBalance || isCancelling}
      />
      </div>

       {/* Generating Progress Modal */}
      <Dialog open={isGenerating} onOpenChange={(open) => { if(!open && isGenerating) handleCancelGeneration() }}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
            <DialogHeader>
                <DialogTitle>문제 생성 중...</DialogTitle>
                <DialogDescription>
                   AI가 지문을 분석하고 문제를 생성하고 있습니다.
                </DialogDescription>
            </DialogHeader>
            
            <div className="flex flex-col items-center justify-center py-8 space-y-6">
                 <div className="relative">
                    <div className="h-16 w-16 rounded-full border-4 border-gray-100 flex items-center justify-center">
                        <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    </div>
                 </div>
                 
                 <div className="text-center space-y-2">
                    <h3 className="font-semibold text-lg">{problemType.type_name}</h3>
                    <p className="text-sm text-gray-500">
                      잠시만 기다려주세요...
                      <span className="inline-flex items-center text-xs font-semibold text-primary ml-1">
                        (예상 시간 {singleExpectedRemainingMinutes}분)
                      </span>
                    </p>
                 </div>
            </div>

            <DialogFooter className="justify-center">
                <Button variant="ghost" onClick={handleCancelGeneration} className="w-full text-red-500 hover:text-red-600 hover:bg-red-50">
                    <X className="w-4 h-4 mr-2" />
                    취소
                </Button>
            </DialogFooter>
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
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex justify-center">
            <Button onClick={() => setShowCancellationResult(false)} className="w-full sm:w-auto">
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {viewMode === 'RESULT' && generatedQuestion && (
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
          </div>

           {/* Floating Action Bar (Sticky Top) */}
           <div className="sticky top-4 z-50 bg-background/80 backdrop-blur-md border rounded-xl shadow-sm p-4 mb-6 flex items-center justify-between transition-all duration-200">
                <div className="flex items-center gap-4">
                     <span className="text-sm font-semibold">
                         {problemType.type_name}
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
                        onClick={handleSave}
                        disabled={isSaving || isSaved}
                        className={isSaved ? "bg-green-600 text-white hover:bg-green-700" : "bg-primary text-white"}
                     >
                        {isSaved ? (
                            <>
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                저장 완료
                            </>
                        ) : (
                            '문제 저장'
                        )}
                     </Button>
                </div>
           </div>


          <div 
             className="grid gap-6 md:grid-cols-1 lg:grid-cols-1 transition-transform duration-200 origin-top-left text-left" // Single column for single question
             style={{
                transform: `scale(${scale / 100})`,
                width: `${100 / (scale / 100)}%`,
                marginBottom: `${((scale / 100) - 1) * 100}%`
             }}
           > 
              <div 
                className={`transition-all duration-200 ring-2 ring-primary ring-offset-2 rounded-xl`}
              >
              <Card className="border-2 flex flex-col h-full hover:border-primary/50">
                <CardHeader className="bg-gray-50 border-b py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base font-semibold">{problemType.type_name}</CardTitle>
                      <Badge variant={problemType.provider === 'openai' ? 'default' : 'secondary'} className="text-xs px-2 py-0.5">
                        {problemType.provider === 'openai' ? 'AI (OpenAI)' : 'AI'}
                      </Badge> 
                    </div>
                    {isSaved && (
                        <div className="flex items-center gap-1 text-green-600 bg-green-50 px-2 py-1 rounded-full text-xs font-medium border border-green-200">
                          <CheckCircle2 className="w-3 h-3" />
                          저장됨
                        </div>
                    )}
                  </div>
                </CardHeader>
                
                <CardContent className="pt-4 flex-1 space-y-4">
                    {/* Metadata: Rating & Tags */}
                    <div className="flex items-center justify-between">
                         {/* Rating */}
                        <div className="flex items-center gap-0.5">
                            {[1, 2, 3].map((star) => (
                                <button
                                    key={star}
                                    onClick={() => updateQuestionData({ rating: generatedQuestion.rating === star ? 0 : star })} 
                                    className={`transition-colors focus:outline-none p-1 ${
                                        (generatedQuestion.rating || 0) >= star 
                                        ? 'text-yellow-400 fill-yellow-400' 
                                        : 'text-gray-300 hover:text-yellow-200'
                                    }`}
                                >
                                    <Star className={`w-5 h-5 ${(generatedQuestion.rating || 0) >= star ? 'fill-current' : ''}`} />
                                </button>
                            ))}
                        </div>

                         {/* Tags */}
                         <div className="flex flex-wrap items-center justify-end gap-1.5 flex-1 ml-4">
                            {(generatedQuestion.tags || []).map(tag => (
                                <Badge key={tag} variant="outline" className="text-xs pl-2 pr-1 py-0.5 h-6 gap-1 group bg-white">
                                    {tag}
                                    <button 
                                        onClick={() => updateQuestionData({ tags: generatedQuestion.tags.filter(t => t !== tag) })}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground rounded-full p-0.5"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </Badge>
                            ))}
                            
                             <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-full border border-dashed hover:border-solid hover:bg-gray-100">
                                        <Plus className="w-3 h-3" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-60 p-3" align="end">
                                    <div className="flex gap-2">
                                        <Input 
                                            placeholder="태그 입력..."
                                            className="h-8 text-sm"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                                    e.preventDefault();
                                                    const val = (e.currentTarget as HTMLInputElement).value.trim();
                                                    if(val) {
                                                        if(!generatedQuestion.tags.includes(val)) {
                                                            updateQuestionData({ tags: [...generatedQuestion.tags, val] })
                                                        } else {
                                                            toast.error('이미 존재하는 태그입니다')
                                                        }
                                                        (e.currentTarget as HTMLInputElement).value = ''
                                                    }
                                                }
                                            }}
                                        />
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-2 text-right">엔터키를 눌러 추가</p>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                  
                  <div className="bg-white rounded-lg border p-4 shadow-sm">
                      <QuestionPreview 
                        question={generatedQuestion.question} 
                        showSaveButton={false}
                      />
                  </div>
                </CardContent>
              </Card>
              </div>
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
              저장된 목록 보기
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
        showCloseButton={false}
      >
        <DialogContent>
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
    </div>
  )
}
