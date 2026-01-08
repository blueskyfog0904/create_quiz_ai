'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Question } from '@/lib/ai/types'
import { ExportButtons } from './export-buttons'
import { toast } from 'sonner'

interface QuestionWithNumber extends Question {
  number: number
  questionTextForward?: string | null
  questionTextBackward?: string | null
}

interface ExamPaperViewProps {
  questions: QuestionWithNumber[]
  examPaper: {
    paper_title: string
    description?: string | null
  }
}

export type ViewMode = 'exam-only' | 'answer-only' | 'exam-with-answers'

export function ExamPaperView({ questions: initialQuestions, examPaper }: ExamPaperViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('exam-with-answers')
  const [questions, setQuestions] = useState(initialQuestions)

  const handleReorder = (fromIndex: number, toPosition: number) => {
    if (fromIndex === toPosition) return

    const fromNumber = fromIndex + 1
    const toNumber = toPosition + 1

    const newQuestions = [...questions]
    const [movedQuestion] = newQuestions.splice(fromIndex, 1)
    newQuestions.splice(toPosition, 0, movedQuestion)

    // Update all question numbers
    const reorderedQuestions = newQuestions.map((q, idx) => ({
      ...q,
      number: idx + 1
    }))

    setQuestions(reorderedQuestions)
    
    // Show toast notification
    toast.success(`문제 위치가 ${fromNumber}번에서 ${toNumber}번으로 변경되었습니다.`)
  }

  return (
    <div className="space-y-8">
      {/* View Mode Selector */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <Label className="text-base font-semibold mb-3 block">표시 모드</Label>
          <RadioGroup 
            value={viewMode} 
            onValueChange={(value) => setViewMode(value as ViewMode)}
            className="flex gap-6"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="exam-only" id="exam-only" />
              <Label htmlFor="exam-only" className="cursor-pointer font-normal">
                시험지
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="answer-only" id="answer-only" />
              <Label htmlFor="answer-only" className="cursor-pointer font-normal">
                답안
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="exam-with-answers" id="exam-with-answers" />
              <Label htmlFor="exam-with-answers" className="cursor-pointer font-normal">
                시험지 + 답안
              </Label>
            </div>
          </RadioGroup>
          <p className="text-sm text-gray-600 mt-2">
            {viewMode === 'exam-only' 
              ? '문제와 선택지만 표시됩니다.' 
              : viewMode === 'answer-only'
              ? '정답과 해설만 표시됩니다.'
              : '문제, 선택지, 정답, 해설이 모두 표시됩니다.'}
          </p>
        </CardContent>
      </Card>

      {/* Questions Display */}
      <h2 className="text-2xl font-bold">문제 목록</h2>
      
      {questions.map((question, index) => (
        <div key={`question-${index}`} className="relative">
          <div className="absolute -left-12 top-4">
            <Select
              value={String(index + 1)}
              onValueChange={(value) => handleReorder(index, parseInt(value) - 1)}
            >
              <SelectTrigger className="w-16 h-10 text-xl font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {questions.map((_, idx) => (
                  <SelectItem key={idx} value={String(idx + 1)}>
                    {idx + 1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Card className="ml-4">
            <CardContent className="pt-6">
              {/* Question Text Forward (hide in answer-only mode) */}
              {viewMode !== 'answer-only' && question.questionTextForward && (
                <div className="mb-4 p-3 bg-gray-100 rounded-lg border-l-4 border-gray-400">
                  <p className="whitespace-pre-wrap text-gray-700">{question.questionTextForward}</p>
                </div>
              )}

              {/* Question Text (hide in answer-only mode) */}
              {viewMode !== 'answer-only' && (
                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">문제</h3>
                  <p className="whitespace-pre-wrap text-gray-800 leading-relaxed">
                    {question.number}. {question.questionText}
                  </p>
                </div>
              )}

              {/* Question Text Backward (hide in answer-only mode) */}
              {viewMode !== 'answer-only' && question.questionTextBackward && (
                <div className="mb-4 p-3 bg-gray-100 rounded-lg border-l-4 border-gray-400">
                  <p className="whitespace-pre-wrap text-gray-700">{question.questionTextBackward}</p>
                </div>
              )}

              {/* Choices (hide in answer-only mode) */}
              {viewMode !== 'answer-only' && (
                <div className="mb-6">
                  <h4 className="text-base font-semibold mb-2">선택지</h4>
                  <div className="space-y-2 pl-2">
                    {question.choices.map((choice) => (
                      <div key={choice.label} className="flex gap-2">
                        <span className="font-semibold min-w-[24px]">{choice.label}</span>
                        <span className="text-gray-700">{choice.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Answer and Explanation (show in answer-only and exam-with-answers mode) */}
              {(viewMode === 'answer-only' || viewMode === 'exam-with-answers') && (
                <>
                  {/* Question number for answer-only mode */}
                  {viewMode === 'answer-only' && (
                    <div className="mb-4">
                      <span className="text-lg font-bold text-gray-800">{question.number}번</span>
                    </div>
                  )}

                  <div className={viewMode === 'exam-with-answers' ? 'border-t pt-4 mb-4' : 'mb-4'}>
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h4 className="text-base font-bold text-blue-900 mb-1">정답</h4>
                      <p className="text-blue-800 font-semibold">{question.answer}</p>
                    </div>
                  </div>

                  {question.explanation && (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <h4 className="text-base font-bold text-gray-900 mb-2">해설</h4>
                      <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {question.explanation}
                      </p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ))}

      {/* Export Buttons */}
      <div className="mt-8">
        <ExportButtons
          examPaper={examPaper}
          questions={questions}
          viewMode={viewMode}
        />
      </div>
    </div>
  )
}

