'use client'

import { useState, useRef } from 'react'
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
import { Loader2, BookOpen, Plus, FileText, CheckCircle2, X, ChevronLeft } from 'lucide-react'
import { PassageSelectorModal } from '@/components/features/passages/passage-selector-modal'
import { Passage } from '@/app/api/passages/actions'
import { Textarea } from '@/components/ui/textarea'

type ProblemType = Database['public']['Tables']['problem_types']['Row']

interface MultiGenerateClientProps {
  problemTypes: ProblemType[]
}

interface GeneratedQuestionData {
  question: Question
  rawResponse: string
  problemType: ProblemType
}

export default function MultiGenerateClient({ problemTypes }: MultiGenerateClientProps) {
  const router = useRouter()
  const [passage, setPassage] = useState('')
  const [selectedPassage, setSelectedPassage] = useState<Passage | null>(null)
  
  // AbortController ref for cancelling generation
  const abortControllerRef = useRef<AbortController | null>(null)

  const [viewMode, setViewMode] = useState<'FORM' | 'RESULT'>('FORM')
  
  const [gradeLevel, setGradeLevel] = useState('High1')
  const [difficulty, setDifficulty] = useState('Medium')
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([])
  
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedQuestions, setGeneratedQuestions] = useState<Map<string, GeneratedQuestionData>>(new Map())
  const [savedStates, setSavedStates] = useState<Map<string, boolean>>(new Map())
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
  const [generatingProgress, setGeneratingProgress] = useState({ current: 0, total: 0, currentType: '' })

  const [isSelectorOpen, setIsSelectorOpen] = useState(false)

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



  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (selectedTypeIds.length === 0) {
      toast.error("최소 1개 이상의 문제 유형을 선택해주세요")
      return
    }

    if (!passage) {
      toast.error("지문을 선택하거나 등록해주세요")
      return
    }

    // Create new AbortController
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    setIsGenerating(true)
    setGeneratedQuestions(new Map())
    setSavedStates(new Map())
    setGeneratingProgress({ current: 0, total: selectedTypeIds.length, currentType: '' })

    try {
      // 각 문제 유형에 대해 순차적으로 API 호출 (rate limit 방지)
      const results = []
      
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
            await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(resolve, 1000)
                signal.addEventListener('abort', () => {
                    clearTimeout(timeoutId)
                    reject(new Error('Generation cancelled'))
                })
            })
          }

          const res = await fetch('/api/questions/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              passage,
              gradeLevel,
              difficulty,
              problemTypeId: typeId
            }),
            signal // Pass the abort signal
          })

          const data = await res.json()

          if (!res.ok || !data.success) {
            throw new Error(data.error?.message || "문제 생성에 실패했습니다")
          }
          
          results.push({
            typeId,
            success: true,
            data: {
              question: data.data,
              rawResponse: data.rawAiResponse,
              problemType: problemType!
            }
          })

          // 성공한 결과를 즉시 화면에 표시
          setGeneratedQuestions(prev => {
            const newMap = new Map(prev)
            newMap.set(typeId, {
              question: data.data,
              rawResponse: data.rawAiResponse,
              problemType: problemType!
            })
            return newMap
          })

          toast.success(`"${problemType?.type_name}" 문제가 생성되었습니다 (${i + 1}/${selectedTypeIds.length})`)

        } catch (error: any) {
          console.error(`Failed to generate question for type ${typeId}:`, error)
          const problemType = problemTypes.find(pt => pt.id === typeId)
          results.push({
            typeId,
            success: false,
            error: error.message
          })
          toast.error(`"${problemType?.type_name}" 문제 생성 실패: ${error.message}`)
        }
      }

      // 결과 요약
      let successCount = 0
      let failCount = 0

      results.forEach(result => {
        if (result.success) {
          successCount++
        } else {
          failCount++
        }
      })

      if (successCount > 0) {
        toast.success(`모든 문제가 생성되었습니다! (${successCount}개)`)
        setViewMode('RESULT')
      } else if (successCount > 0 && failCount > 0) {
        toast.info(`${successCount}개 생성 완료, ${failCount}개 실패`)
        setViewMode('RESULT')
      } else if (failCount === selectedTypeIds.length) {
        toast.error("모든 문제 생성에 실패했습니다. 다시 시도해주세요.")
      }

    } catch (error: any) {
        if (error.name === 'AbortError' || error.message === 'Generation cancelled') {
            console.log('Generation cancelled by user')
            // Toast handled in handleCancelGeneration
        } else {
            console.error(error)
            toast.error("문제 생성 중 오류가 발생했습니다")
        }
    } finally {
      setIsGenerating(false)
      abortControllerRef.current = null
    }
  }

  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        toast.info("문제 생성을 중단했습니다")
        // State cleanup handled in catch/finally block of handleGenerate
    }
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
          gradeLevel,
          difficulty,
          problemTypeId: typeId,
          rawAiResponse: questionData.rawResponse,
          source_passage_id: selectedPassage?.id // Save link to passage if available
        })
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "문제 저장에 실패했습니다")
      }

      toast.success(`"${questionData.problemType.type_name}" 문제가 저장되었습니다`)
      
    } catch (error: any) {
      toast.error(error.message)
      setSavedStates(new Map(savedStates.set(typeId, false))) // Revert
    }
  }

  const handleSaveAll = async () => {
    if (generatedQuestions.size === 0) return

    const unsavedQuestions = Array.from(generatedQuestions.entries()).filter(
      ([typeId]) => !savedStates.get(typeId)
    )

    if (unsavedQuestions.length === 0) {
      toast.info("모든 문제가 이미 저장되었습니다")
      return
    }

    setIsGenerating(true)

    try {
      let successCount = 0
      let failCount = 0

      for (const [typeId, questionData] of unsavedQuestions) {
        try {
          const res = await fetch('/api/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: questionData.question,
              passage,
              gradeLevel,
              difficulty,
              problemTypeId: typeId,
              rawAiResponse: questionData.rawResponse,
              source_passage_id: selectedPassage?.id
            })
          })

          const data = await res.json()

          if (!res.ok || !data.success) {
            throw new Error(data.error?.message || "문제 저장에 실패했습니다")
          }

          setSavedStates(new Map(savedStates.set(typeId, true)))
          successCount++
        } catch (error: any) {
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

    } catch (error: any) {
      toast.error("문제 저장 중 오류가 발생했습니다")
    } finally {
      setIsGenerating(false)
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

  const handleGoToExamPaper = () => {
    router.push('/exam-papers')
  }

  if (viewMode === 'RESULT') {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
            <Button 
                variant="ghost" 
                onClick={() => setViewMode('FORM')}
                className="gap-2 pl-2"
            >
                <ChevronLeft className="w-5 h-5" />
                문제 생성 옵션으로 돌아가기
            </Button>
            <h1 className="text-2xl font-bold">생성된 문제 목록</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
             {Array.from(generatedQuestions.entries()).map(([typeId, questionData]) => (
                <Card key={typeId} className="border-2 flex flex-col">
                  <CardHeader className="bg-gray-50 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{questionData.problemType.type_name}</CardTitle>
                        <Badge variant={questionData.problemType.provider === 'openai' ? 'default' : 'secondary'}>
                          {questionData.problemType.provider === 'openai' ? 'OpenAI' : 'Gemini'}
                        </Badge>
                        {savedStates.get(typeId) && (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            저장됨
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-6 flex-1">
                    <QuestionPreview 
                      question={questionData.question} 
                      onSave={() => handleSaveIndividual(typeId)}
                      isSaving={false} // Loading logic handled in parent? Actually savedStates usage is correct here
                      showSaveButton={!savedStates.get(typeId)}
                    />
                  </CardContent>
                </Card>
              ))}
        </div>

        {/* Save All Button (Fixed at bottom or static) */}
        <div className="sticky bottom-4 z-10 text-center pointer-events-none">
            <div className="inline-block shadow-lg rounded-xl overflow-hidden pointer-events-auto">
            <Card className="border-2 border-primary">
                <CardContent className="p-4 flex items-center gap-6">
                    <div className="text-left">
                        <p className="font-bold text-lg">
                        총 {generatedQuestions.size}문제 생성됨
                        </p>
                        <p className="text-sm text-gray-500">
                        {Array.from(savedStates.values()).filter(Boolean).length}개 저장 완료
                        </p>
                    </div>
                    <Button 
                        onClick={handleSaveAll}
                        disabled={isGenerating || Array.from(savedStates.values()).filter(Boolean).length === generatedQuestions.size}
                        size="lg"
                        className="bg-primary hover:bg-primary/90 text-white min-w-[120px]"
                    >
                        전체 저장
                    </Button>
                </CardContent>
            </Card>
            </div>
        </div>
        
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
                문제지 생성 페이지로 이동
                </Button>
            </DialogFooter>
            </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Input Form */}
      <div className="space-y-6">
      {viewMode === 'FORM' && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="text-xl font-semibold mb-4">문제 생성 옵션</h2>
              
              <form onSubmit={handleGenerate} className="space-y-4">
                
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
                          disabled={isGenerating}
                        >
                            <BookOpen className="w-4 h-4" />
                            내 영어지문 불러오기
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="flex-1 gap-2 h-12"
                          onClick={() => router.push('/library/mypassages')}
                          disabled={isGenerating}
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

                {/* Problem Type Selection */}
                <div className="space-y-3">
                  <Label className="text-base font-semibold">
                    문제 유형 선택 <span className="text-red-500">*</span>
                    <span className="text-sm text-gray-500 ml-2">
                      ({selectedTypeIds.length}개 선택됨)
                    </span>
                  </Label>
                  <div className="border rounded-lg p-4 space-y-3 max-h-[300px] overflow-y-auto">
                    {problemTypes.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-4">
                        등록된 문제 유형이 없습니다
                      </p>
                    ) : (
                      problemTypes.map((type) => (
                        <div key={type.id} className="flex items-start space-x-3 p-3 rounded-md hover:bg-gray-50 border">
                          <Checkbox
                            id={type.id}
                            checked={selectedTypeIds.includes(type.id)}
                            onCheckedChange={(checked) => handleTypeToggle(type.id, checked as boolean)}
                            disabled={isGenerating}
                          />
                          <div className="flex-1">
                            <label
                              htmlFor={type.id}
                              className="text-sm font-medium leading-none cursor-pointer flex items-center gap-2"
                            >
                              {type.type_name}
                              <Badge variant={type.provider === 'openai' ? 'default' : 'secondary'} className="text-xs">
                                {type.provider === 'openai' ? 'OpenAI' : 'Gemini'}
                              </Badge>
                            </label>
                            {type.description && (
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                {type.description}
                              </p>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Grade and Difficulty */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="grade">학년</Label>
                    <Select value={gradeLevel} onValueChange={setGradeLevel} disabled={isGenerating}>
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
                    <Select value={difficulty} onValueChange={setDifficulty} disabled={isGenerating}>
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
                  disabled={isGenerating || selectedTypeIds.length === 0 || !passage}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      문제 생성 중...
                    </>
                  ) : (
                    '문제 생성 시작'
                  )}
                </Button>

                </form>
              </CardContent>
            </Card>
      )}
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
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">생성된 문제</h2>
            <Button variant="outline" onClick={() => setViewMode('FORM')}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              문제 생성 폼으로 돌아가기
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6"> {/* Apply 2-column grid */}
            {Array.from(generatedQuestions.entries()).map(([typeId, questionData]) => (
              <Card key={typeId} className="border-2">
                <CardHeader className="bg-gray-50 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{questionData.problemType.type_name}</CardTitle>
                      <Badge variant={questionData.problemType.provider === 'openai' ? 'default' : 'secondary'}>
                        {questionData.problemType.provider === 'openai' ? 'OpenAI' : 'Gemini'}
                      </Badge>
                      {savedStates.get(typeId) && (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          저장됨
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <QuestionPreview 
                    question={questionData.question} 
                    onSave={() => handleSaveIndividual(typeId)}
                    isSaving={false} // Loading logic handled in parent? Actually savedStates usage is correct here
                    showSaveButton={!savedStates.get(typeId)}
                  />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Save All Button */}
          <div className="sticky bottom-4 z-10 text-center">
              <div className="inline-block shadow-lg rounded-xl overflow-hidden">
                  <Card className="border-2 border-primary">
                  <CardContent className="p-4 flex items-center gap-6">
                      <div className="text-left">
                          <p className="font-bold text-lg">
                          총 {generatedQuestions.size}문제 생성됨
                          </p>
                          <p className="text-sm text-gray-500">
                          {Array.from(savedStates.values()).filter(Boolean).length}개 저장 완료
                          </p>
                      </div>
                      <Button 
                          onClick={handleSaveAll}
                          disabled={isGenerating || Array.from(savedStates.values()).filter(Boolean).length === generatedQuestions.size}
                          size="lg"
                          className="bg-primary hover:bg-primary/90 text-white min-w-[120px]"
                      >
                          전체 저장
                      </Button>
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
              문제지 생성 페이지로 이동
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PassageSelectorModal
        open={isSelectorOpen}
        onOpenChange={setIsSelectorOpen}
        onSelect={handlePassageSelect}
      />

      {/* Progress Modal - Moved here to be accessible in both views if needed, but primarily triggered from FORM */}
       <Dialog open={isGenerating} onOpenChange={() => {}}>
            <DialogContent className="sm:max-w-md" showCloseButton={false}>
                <div className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6" 
                        onClick={handleCancelGeneration}
                    >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Close</span>
                    </Button>
                </div>
                
                <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                    <DialogTitle className="text-lg font-medium text-center mb-2">
                        AI가 문제를 생성 중에 있습니다
                    </DialogTitle>
                    <DialogDescription className="text-center mb-6">
                        잠시만 기다려주세요...
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
                                <p className="text-xs text-gray-500 mt-2 text-center">
                                    현재 생성 중: <span className="font-medium text-gray-700">{generatingProgress.currentType}</span>
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
          </Dialog>

    </div>
  )
}

