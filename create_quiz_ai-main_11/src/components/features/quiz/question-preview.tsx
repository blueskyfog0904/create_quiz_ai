import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Question } from '@/lib/ai/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface QuestionPreviewProps {
  question: Question
  onSave?: () => void
  isSaving?: boolean
  showSaveButton?: boolean
}

export function QuestionPreview({ question, onSave, isSaving, showSaveButton = true }: QuestionPreviewProps) {
  return (
    <Card className="w-full border-2 border-primary/20 shadow-lg">
      <CardHeader className="bg-gray-50">
        <div className="flex justify-between items-center">
            <CardTitle className="text-lg">문제 미리보기</CardTitle>
            {showSaveButton && onSave && (
                <Button onClick={onSave} disabled={isSaving}>
                    {isSaving ? '저장 중...' : '문제 은행에 저장'}
                </Button>
            )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-6">
        
        {/* Question Text */}
        <div className="space-y-2">
          <Label className="text-muted-foreground font-semibold">문제</Label>
          <div className="p-4 bg-white rounded-md border text-lg font-medium whitespace-pre-wrap">
            {question.questionText}
          </div>
        </div>

        {/* Choices */}
        <div className="space-y-2">
          <Label className="text-muted-foreground font-semibold">선택지</Label>
          <div className="grid gap-2">
            {question.choices.map((choice, index) => (
              <div key={index} className="flex items-start p-3 rounded-md border hover:bg-gray-50 bg-white">
                <span className="font-bold mr-3 min-w-[24px]">{choice.label}</span>
                <span>{choice.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Answer */}
            <div className="space-y-2">
                <Label className="text-muted-foreground font-semibold">정답</Label>
                <div className="p-3 bg-green-50 border border-green-200 rounded-md text-green-800 font-bold">
                    {question.answer}
                </div>
            </div>

            {/* Explanation */}
            <div className="space-y-2">
                <Label className="text-muted-foreground font-semibold">해설</Label>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-800 text-sm whitespace-pre-wrap">
                    {question.explanation}
                </div>
            </div>
        </div>
      </CardContent>
    </Card>
  )
}

