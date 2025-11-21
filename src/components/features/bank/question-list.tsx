'use client'

import { useState } from 'react'
import { Database } from '@/types/supabase'
import { QuestionPreview } from '@/components/features/quiz/question-preview'
import { Question } from '@/lib/ai/types'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

type DBQuestion = Database['public']['Tables']['questions']['Row']

interface QuestionListProps {
  questions: DBQuestion[]
}

export function QuestionList({ questions }: QuestionListProps) {
  const router = useRouter()
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [examPaperTitle, setExamPaperTitle] = useState('')
  const [examPaperDescription, setExamPaperDescription] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const handleSelectQuestion = (questionId: string, checked: boolean) => {
    if (checked) {
      setSelectedQuestionIds(prev => [...prev, questionId])
    } else {
      setSelectedQuestionIds(prev => prev.filter(id => id !== questionId))
    }
  }

  const handleSelectAll = () => {
    if (selectedQuestionIds.length === questions.length) {
      setSelectedQuestionIds([])
    } else {
      setSelectedQuestionIds(questions.map(q => q.id))
    }
  }

  const handleCreateExamPaper = async () => {
    if (!examPaperTitle.trim()) {
      toast.error('시험지 제목을 입력해주세요.')
      return
    }

    if (selectedQuestionIds.length === 0) {
      toast.error('최소 1개 이상의 문제를 선택해주세요.')
      return
    }

    setIsCreating(true)
    try {
      const response = await fetch('/api/exam-papers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: examPaperTitle,
          description: examPaperDescription,
          questionIds: selectedQuestionIds
        })
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || '시험지 생성에 실패했습니다.')
      }

      toast.success('시험지가 생성되었습니다!')
      setIsDialogOpen(false)
      setExamPaperTitle('')
      setExamPaperDescription('')
      setSelectedQuestionIds([])
      
      // Redirect to exam papers page
      router.push('/exam-papers')
    } catch (error: any) {
      console.error('Create exam paper error:', error)
      toast.error(error.message)
    } finally {
      setIsCreating(false)
    }
  }

  if (questions.length === 0) {
    return (
      <div className="text-center py-10 text-gray-500">
        저장된 문제가 없습니다. '문제 생성' 페이지에서 문제를 만들어보세요!
      </div>
    )
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between bg-gray-50 p-4 rounded-lg border">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
          >
            {selectedQuestionIds.length === questions.length ? '전체 해제' : '전체 선택'}
          </Button>
          <span className="text-sm text-gray-600">
            {selectedQuestionIds.length}개 선택됨
          </span>
        </div>
        <Button
          onClick={() => setIsDialogOpen(true)}
          disabled={selectedQuestionIds.length === 0}
        >
          선택한 문제로 시험지 만들기
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
        {questions.map((q) => {
          const mappedQuestion: Question = {
            questionText: q.question_text,
            choices: q.choices as any,
            answer: q.answer,
            explanation: q.explanation || ''
          }

          const isSelected = selectedQuestionIds.includes(q.id)

          return (
            <div key={q.id} className={`relative border-2 rounded-lg p-4 transition-all ${isSelected ? 'border-primary bg-primary/5' : 'border-transparent'}`}>
              <div className="absolute top-2 left-2 z-10">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => handleSelectQuestion(q.id, checked as boolean)}
                />
              </div>
              <div className="absolute top-2 right-2 z-10 flex gap-1">
                <span className="px-2 py-1 text-xs bg-gray-200 rounded">{q.grade_level}</span>
                <span className="px-2 py-1 text-xs bg-gray-200 rounded">{q.difficulty}</span>
              </div>
              <div className="ml-8">
                <QuestionPreview question={mappedQuestion} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Create Exam Paper Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>시험지 만들기</DialogTitle>
            <DialogDescription>
              선택한 {selectedQuestionIds.length}개의 문제로 시험지를 생성합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">시험지 제목 *</Label>
              <Input
                id="title"
                placeholder="예: 2025학년도 1학기 중간고사"
                value={examPaperTitle}
                onChange={(e) => setExamPaperTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">설명</Label>
              <Textarea
                id="description"
                placeholder="시험지에 대한 설명을 입력하세요 (선택사항)"
                value={examPaperDescription}
                onChange={(e) => setExamPaperDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              취소
            </Button>
            <Button onClick={handleCreateExamPaper} disabled={isCreating}>
              {isCreating ? '생성 중...' : '시험지 생성'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
