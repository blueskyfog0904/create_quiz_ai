'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
import { Loader2 } from 'lucide-react'

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
  const [gradeLevel, setGradeLevel] = useState('High1')
  const [difficulty, setDifficulty] = useState('Medium')
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([])
  
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedQuestions, setGeneratedQuestions] = useState<Map<string, GeneratedQuestionData>>(new Map())
  const [savedStates, setSavedStates] = useState<Map<string, boolean>>(new Map())
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)
  const [generatingProgress, setGeneratingProgress] = useState({ current: 0, total: 0, currentType: '' })

  const handleTypeToggle = (typeId: string, checked: boolean) => {
    if (checked) {
      setSelectedTypeIds([...selectedTypeIds, typeId])
    } else {
      setSelectedTypeIds(selectedTypeIds.filter(id => id !== typeId))
    }
  }

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (selectedTypeIds.length === 0) {
      toast.error("최소 1개 이상의 문제 유형을 선택해주세요")
      return
    }

    if (!passage) {
      toast.error("지문을 입력해주세요")
      return
    }

    if (passage.length > 3000) {
      toast.error("지문이 너무 깁니다 (최대 3000자)")
      return
    }

    setIsGenerating(true)
    setGeneratedQuestions(new Map())
    setSavedStates(new Map())
    setGeneratingProgress({ current: 0, total: selectedTypeIds.length, currentType: '' })

    try {
      // 각 문제 유형에 대해 순차적으로 API 호출 (rate limit 방지)
      const results = []
      
      for (let i = 0; i < selectedTypeIds.length; i++) {
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
            await new Promise(resolve => setTimeout(resolve, 1000))
          }

          const res = await fetch('/api/questions/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              passage,
              gradeLevel,
              difficulty,
              problemTypeId: typeId
            })
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

      if (successCount > 0 && failCount === 0) {
        toast.success(`모든 문제가 생성되었습니다! (${successCount}개)`)
      } else if (successCount > 0 && failCount > 0) {
        toast.info(`${successCount}개 생성 완료, ${failCount}개 실패`)
      } else if (failCount === selectedTypeIds.length) {
        toast.error("모든 문제 생성에 실패했습니다. 다시 시도해주세요.")
      }

    } catch (error: any) {
      console.error(error)
      toast.error("문제 생성 중 오류가 발생했습니다")
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSaveIndividual = async (typeId: string) => {
    const questionData = generatedQuestions.get(typeId)
    if (!questionData) return

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
          rawAiResponse: questionData.rawResponse
        })
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "문제 저장에 실패했습니다")
      }

      toast.success(`"${questionData.problemType.type_name}" 문제가 저장되었습니다`)
      
    } catch (error: any) {
      toast.error(error.message)
      setSavedStates(new Map(savedStates.set(typeId, false)))
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
              rawAiResponse: questionData.rawResponse
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
    setPassage('')
    setSelectedTypeIds([])
  }

  const handleGoToExamPaper = () => {
    router.push('/exam-papers')
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Input Form */}
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <h2 className="text-xl font-semibold mb-4">문제 생성 옵션</h2>
              
              <form onSubmit={handleGenerate} className="space-y-4">
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

                {/* Passage Input */}
                <div className="space-y-2">
                  <Label htmlFor="passage">
                    지문 텍스트 <span className="text-red-500">*</span>
                    <span className={passage.length > 3000 ? "text-red-500 ml-2" : "text-gray-400 ml-2"}>
                      ({passage.length}/3000)
                    </span>
                  </Label>
                  <Textarea 
                    id="passage" 
                    placeholder="영어 지문을 입력하세요..." 
                    className="min-h-[200px] font-mono text-sm"
                    value={passage}
                    onChange={(e) => setPassage(e.target.value)}
                    maxLength={3000}
                    disabled={isGenerating}
                    required
                  />
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
                  className="w-full" 
                  disabled={isGenerating || selectedTypeIds.length === 0}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      생성 중...
                    </>
                  ) : (
                    '문제 생성'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Preview Area */}
        <div className="space-y-6">
          {/* Loading Progress Card */}
          {isGenerating && (
            <Card className="min-h-[200px] flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/20">
              <div className="text-center p-8 w-full max-w-md">
                <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
                <p className="text-lg font-medium text-primary mb-2">
                  AI가 문제를 생성 중에 있습니다
                </p>
                <p className="text-sm text-gray-600 mb-4">
                  잠시만 기다려주세요...
                </p>
                
                {generatingProgress.total > 0 && (
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">진행 상황</span>
                      <span className="font-medium text-primary">
                        {generatingProgress.current} / {generatingProgress.total}
                      </span>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div 
                        className="bg-primary h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${(generatingProgress.current / generatingProgress.total) * 100}%` }}
                      />
                    </div>
                    
                    {generatingProgress.currentType && (
                      <p className="text-xs text-gray-500 mt-2">
                        현재 생성 중: <span className="font-medium text-gray-700">{generatingProgress.currentType}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Generated Questions */}
          {generatedQuestions.size > 0 ? (
            <>
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
                      isSaving={false}
                      showSaveButton={!savedStates.get(typeId)}
                    />
                  </CardContent>
                </Card>
              ))}

              {/* Save All Button */}
              <div className="sticky bottom-4 z-10">
                <Card className="border-2 border-primary shadow-lg">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">
                          총 {generatedQuestions.size}개의 문제 생성 완료
                        </p>
                        <p className="text-sm text-gray-500">
                          {Array.from(savedStates.values()).filter(Boolean).length}개 저장됨
                        </p>
                      </div>
                      <Button 
                        onClick={handleSaveAll}
                        disabled={isGenerating || Array.from(savedStates.values()).filter(Boolean).length === generatedQuestions.size}
                        size="lg"
                      >
                        전체 저장
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : !isGenerating && (
            <Card className="h-full min-h-[400px] flex items-center justify-center bg-gray-50 border-dashed border-2">
              <div className="text-center text-gray-400 p-8">
                <p className="text-lg font-medium mb-2">문제 생성 준비 완료</p>
                <p className="text-sm">문제 유형을 선택하고 지문을 작성한 후</p>
                <p className="text-sm">문제 생성 버튼을 클릭하세요.</p>
              </div>
            </Card>
          )}
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
    </>
  )
}

