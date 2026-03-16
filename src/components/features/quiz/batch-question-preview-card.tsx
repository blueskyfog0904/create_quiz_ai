'use client'

import { CheckCircle2, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { QuestionPreview } from '@/components/features/quiz/question-preview'
import type { StagedGeneratedQuestion } from '@/lib/questions/generated-question-staging'

interface BatchQuestionPreviewCardProps {
  questionNumber: string
  problemTypeName: string
  generatedQuestion: StagedGeneratedQuestion
  isSelected: boolean
  saveStatus: string
  saveErrorMessage?: string | null
  onSelectChange: (checked: boolean) => void
  onSave: () => void
  isSaving: boolean
}

const saveStatusLabel: Record<string, string> = {
  unsaved: '미저장',
  saving: '저장 중',
  saved: '저장 완료',
  save_failed: '저장 실패',
}

const saveStatusClassName: Record<string, string> = {
  unsaved: 'bg-slate-100 text-slate-700',
  saving: 'bg-blue-100 text-blue-700',
  saved: 'bg-emerald-100 text-emerald-700',
  save_failed: 'bg-rose-100 text-rose-700',
}

export function BatchQuestionPreviewCard({
  questionNumber,
  problemTypeName,
  generatedQuestion,
  isSelected,
  saveStatus,
  saveErrorMessage,
  onSelectChange,
  onSave,
  isSaving,
}: BatchQuestionPreviewCardProps) {
  const isSaved = saveStatus === 'saved'

  return (
    <Card className={isSelected ? 'border-primary shadow-md ring-1 ring-primary/30' : ''}>
      <CardHeader className="gap-3 border-b bg-gray-50/80">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={isSelected}
              disabled={isSaved || isSaving}
              onCheckedChange={(checked) => onSelectChange(Boolean(checked))}
            />
            <div>
              <CardTitle className="text-base">{questionNumber}번 · {problemTypeName}</CardTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge className={saveStatusClassName[saveStatus] ?? saveStatusClassName.unsaved}>
                  {saveStatusLabel[saveStatus] ?? saveStatus}
                </Badge>
                {isSaved ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    라이브러리에 저장됨
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <Button
            size="sm"
            onClick={onSave}
            disabled={isSaved || isSaving}
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaved ? '저장 완료' : '개별 저장'}
          </Button>
        </div>

        {saveErrorMessage ? (
          <p className="text-sm text-rose-600">{saveErrorMessage}</p>
        ) : null}
      </CardHeader>

      <CardContent className="p-6">
        <QuestionPreview
          question={generatedQuestion}
          showCard={false}
          showSaveButton={false}
        />
      </CardContent>
    </Card>
  )
}
