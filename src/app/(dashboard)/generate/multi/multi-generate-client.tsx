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
import { Star, Tag, Plus, X, ChevronLeft, Loader2, BookOpen, FileText, CheckCircle2, Minus, Maximize, ZoomIn } from 'lucide-react'
import { PassageSelectorModal } from '@/components/features/passages/passage-selector-modal'
import { Passage } from '@/app/api/passages/actions'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'

type ProblemType = Database['public']['Tables']['problem_types']['Row']

interface MultiGenerateClientProps {
  problemTypes: ProblemType[]
}

interface GeneratedQuestionData {
  question: Question
  rawResponse: string
  problemType: ProblemType
  tags: string[]
  rating: number
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
  const [isSaving, setIsSaving] = useState(false)
  const [generatedQuestions, setGeneratedQuestions] = useState<Map<string, GeneratedQuestionData>>(new Map())
  const [savedStates, setSavedStates] = useState<Map<string, boolean>>(new Map())
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
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
      let successCount = 0
      let failCount = 0
      
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
          
          // 성공한 결과를 즉시 화면에 표시
          setGeneratedQuestions(prev => {
            const newMap = new Map(prev)
            newMap.set(typeId, {
              question: data.data,
              rawResponse: data.rawAiResponse,
              problemType: problemType!,
              tags: selectedPassage?.tags || [], // Inherit tags from passage
              rating: 0
            })
            return newMap
          })

          toast.success(`"${problemType?.type_name}" 문제가 생성되었습니다 (${i + 1}/${selectedTypeIds.length})`)
          successCount++

        } catch (error: any) {
          console.error(`Failed to generate question for type ${typeId}:`, error)
          const problemType = problemTypes.find(pt => pt.id === typeId)
          toast.error(`"${problemType?.type_name}" 문제 생성 실패: ${error.message}`)
          failCount++
        }
      }

      if (successCount > 0) {
        toast.success(`모든 문제가 생성되었습니다! (${successCount}개)`)
        // Auto select all generated questions by default in result view?
        // Let's select all initially for convenience
        // We'll handle this effect when viewMode changes or here
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
              gradeLevel,
              difficulty,
              problemTypeId: typeId,
              rawAiResponse: questionData.rawResponse,
              source_passage_id: selectedPassage?.id,
              tags: questionData.tags,    // Send tags
              rating: questionData.rating // Send rating
            })
          })

          const data = await res.json()

          if (!res.ok || !data.success) {
            throw new Error(data.error?.message || "문제 저장에 실패했습니다")
          }

          setSavedStates(prev => new Map(prev.set(typeId, true)))
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

  const handleGoToExamPaper = () => {
    router.push('/library/exam-papers')
  }

  return (
    <div className={`${viewMode === 'RESULT' ? 'max-w-[1700px]' : 'max-w-5xl'} mx-auto space-y-8`}>
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

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">
                        문제 유형 선택 <span className="text-red-500">*</span>
                        <span className="text-sm text-gray-500 ml-2">
                        ({selectedTypeIds.length}개 선택됨)
                        </span>
                    </Label>
                    <Button
                        type="button"
                        variant={selectedTypeIds.length === problemTypes.length ? "outline" : "default"}
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                            if (selectedTypeIds.length === problemTypes.length) {
                                setSelectedTypeIds([])
                            } else {
                                setSelectedTypeIds(problemTypes.map(pt => pt.id))
                            }
                        }}
                    >
                        {selectedTypeIds.length === problemTypes.length ? '전체 해제' : '전체 선택'}
                    </Button>
                  </div>
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
             className="grid gap-6 md:grid-cols-1 lg:grid-cols-2 transition-transform duration-200 origin-top-left"
             style={{
                transform: `scale(${scale / 100})`,
                width: `${100 / (scale / 100)}%`,
                marginBottom: `${((scale / 100) - 1) * 100}%` // compensate spacing
             }}
           > 
            {Array.from(generatedQuestions.entries()).map(([typeId, questionData]) => (
              <div 
                key={typeId} 
                className={`transition-all duration-200 ${
                    selectedResultIds.has(typeId) ? 'ring-2 ring-primary ring-offset-2 rounded-xl' : ''
                }`}
                onClick={() => {
                    // Click card to select, but ignore if clicking interactive elements inside
                     const newSet = new Set(selectedResultIds)
                     if (newSet.has(typeId)) newSet.delete(typeId)
                     else newSet.add(typeId)
                     setSelectedResultIds(newSet)
                }}
              >
              <Card className="border-2 flex flex-col h-full cursor-pointer hover:border-primary/50">
                <CardHeader className="bg-gray-50 border-b py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Checkbox 
                        checked={selectedResultIds.has(typeId)}
                        onCheckedChange={(checked) => {
                             const newSet = new Set(selectedResultIds)
                             if (checked) newSet.add(typeId)
                             else newSet.delete(typeId)
                             setSelectedResultIds(newSet)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <CardTitle className="text-base font-semibold">{questionData.problemType.type_name}</CardTitle>
                      <Badge variant={questionData.problemType.provider === 'openai' ? 'default' : 'secondary'} className="text-xs px-2 py-0.5">
                        {questionData.problemType.provider === 'openai' ? 'AI (OpenAI)' : 'AI'}  {/* Changed label */}
                      </Badge> 
                    </div>
                    {savedStates.get(typeId) && (
                        <div className="flex items-center gap-1 text-green-600 bg-green-50 px-2 py-1 rounded-full text-xs font-medium border border-green-200">
                          <CheckCircle2 className="w-3 h-3" />
                          저장됨
                        </div>
                    )}
                  </div>
                </CardHeader>
                
                <CardContent className="pt-4 flex-1 space-y-4" onClick={(e) => e.stopPropagation()}>
                    {/* Metadata: Rating & Tags */}
                    <div className="flex items-center justify-between">
                         {/* Rating */}
                        <div className="flex items-center gap-0.5">
                            {[1, 2, 3].map((star) => (
                                <button
                                    key={star}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        updateQuestionData(typeId, { rating: questionData.rating === star ? 0 : star })
                                    }} 
                                    className={`transition-colors focus:outline-none p-1 ${
                                        (questionData.rating || 0) >= star 
                                        ? 'text-yellow-400 fill-yellow-400' 
                                        : 'text-gray-300 hover:text-yellow-200'
                                    }`}
                                >
                                    <Star className={`w-5 h-5 ${(questionData.rating || 0) >= star ? 'fill-current' : ''}`} />
                                </button>
                            ))}
                        </div>

                         {/* Tags */}
                         <div className="flex flex-wrap items-center justify-end gap-1.5 flex-1 ml-4">
                            {(questionData.tags || []).map(tag => (
                                <Badge key={tag} variant="outline" className="text-xs pl-2 pr-1 py-0.5 h-6 gap-1 group bg-white">
                                    {tag}
                                    <button 
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            updateQuestionData(typeId, { tags: questionData.tags.filter(t => t !== tag) })
                                        }}
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
                                                        if(!questionData.tags.includes(val)) {
                                                             updateQuestionData(typeId, { tags: [...questionData.tags, val] })
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
                        question={questionData.question} 
                        // Hide internal save button, we use the global one or card selection
                        showSaveButton={false}
                      />
                  </div>
                </CardContent>
              </Card>
              </div>
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

      {/* Progress Modal - Generating */}
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

    </div>
  )
}

