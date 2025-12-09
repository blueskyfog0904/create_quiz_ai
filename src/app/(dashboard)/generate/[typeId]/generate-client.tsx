'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from 'sonner'
import { QuestionPreview } from '@/components/features/quiz/question-preview'
import { Database } from '@/types/supabase'
import { Question } from '@/lib/ai/types'
import { useRouter } from 'next/navigation'

type ProblemType = Database['public']['Tables']['problem_types']['Row']

interface GenerateClientProps {
  problemType: ProblemType
}

export default function GenerateClient({ problemType }: GenerateClientProps) {
  const router = useRouter()
  const [passage, setPassage] = useState('')
  const [gradeLevel, setGradeLevel] = useState('High1')
  const [difficulty, setDifficulty] = useState('Medium')
  const [questionTextForward, setQuestionTextForward] = useState('')
  const [questionTextBackward, setQuestionTextBackward] = useState('')
  
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedQuestion, setGeneratedQuestion] = useState<Question | null>(null)
  const [rawResponse, setRawResponse] = useState<string>('')
  const [showSuccessDialog, setShowSuccessDialog] = useState(false)

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!passage) {
      toast.error("지문을 입력해주세요")
      return
    }

    if (passage.length > 3000) {
      toast.error("지문이 너무 깁니다 (최대 3000자)")
      return
    }

    setIsGenerating(true)
    setGeneratedQuestion(null)

    try {
      const res = await fetch('/api/questions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passage,
          gradeLevel,
          difficulty,
          problemTypeId: problemType.id
        })
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "문제 생성에 실패했습니다")
      }

      setGeneratedQuestion(data.data)
      setRawResponse(data.rawAiResponse)
      toast.success("문제가 생성되었습니다!")

    } catch (error: any) {
      console.error(error)
      toast.error(error.message)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSave = async () => {
    if (!generatedQuestion) return

    setIsGenerating(true)
    try {
        const res = await fetch('/api/questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: generatedQuestion,
                passage,
                gradeLevel,
                difficulty,
                problemTypeId: problemType.id,
                rawAiResponse: rawResponse,
                questionTextForward: questionTextForward || undefined,
                questionTextBackward: questionTextBackward || undefined
            })
        })

        const data = await res.json()

        if (!res.ok || !data.success) {
            throw new Error(data.error?.message || "문제 저장에 실패했습니다")
        }

        setShowSuccessDialog(true)
    } catch (error: any) {
        toast.error(error.message)
    } finally {
        setIsGenerating(false)
    }
  }

  const handleContinueGeneration = () => {
    setShowSuccessDialog(false)
    setGeneratedQuestion(null)
    setPassage('')
    setQuestionTextForward('')
    setQuestionTextBackward('')
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
                <div className="space-y-2">
                  <Label htmlFor="passage">
                      지문 텍스트 <span className={passage.length > 3000 ? "text-red-500" : "text-gray-400"}>({passage.length}/3000)</span>
                  </Label>
                  <Textarea 
                    id="passage" 
                    placeholder="영어 지문을 입력하세요..." 
                    className="min-h-[200px] font-mono text-sm"
                    value={passage}
                    onChange={(e) => setPassage(e.target.value)}
                    maxLength={3000}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="grade">학년</Label>
                    <Select value={gradeLevel} onValueChange={setGradeLevel}>
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
                    <Select value={difficulty} onValueChange={setDifficulty}>
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

                <div className="space-y-2">
                  <Label htmlFor="questionTextForward">문제 앞 텍스트 (선택)</Label>
                  <Textarea
                    id="questionTextForward"
                    placeholder="문제 앞에 박스로 표시될 텍스트를 입력하세요..."
                    className="min-h-[80px] font-mono text-sm"
                    value={questionTextForward}
                    onChange={(e) => setQuestionTextForward(e.target.value)}
                  />
                  <p className="text-xs text-gray-500">입력한 내용이 문제 앞에 배경색 박스로 표시됩니다.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="questionTextBackward">문제 뒤 텍스트 (선택)</Label>
                  <Textarea
                    id="questionTextBackward"
                    placeholder="문제 뒤에 박스로 표시될 텍스트를 입력하세요..."
                    className="min-h-[80px] font-mono text-sm"
                    value={questionTextBackward}
                    onChange={(e) => setQuestionTextBackward(e.target.value)}
                  />
                  <p className="text-xs text-gray-500">입력한 내용이 문제 뒤에 배경색 박스로 표시됩니다.</p>
                </div>

                <Button type="submit" className="w-full" disabled={isGenerating}>
                  {isGenerating ? '생성 중...' : '문제 생성'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Preview Area */}
        <div className="space-y-6">
          {generatedQuestion ? (
            <QuestionPreview question={generatedQuestion} onSave={handleSave} />
          ) : (
            <Card className="h-full min-h-[400px] flex items-center justify-center bg-gray-50 border-dashed">
              <div className="text-center text-gray-400">
                <p className="text-lg font-medium">문제 생성 준비 완료</p>
                <p className="text-sm">폼을 작성하고 문제 생성 버튼을 클릭하세요.</p>
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

