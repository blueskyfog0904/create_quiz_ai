'use client'

import { CheckCircle2, Loader2, Plus, Star, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { QuestionPreview } from '@/components/features/quiz/question-preview'
import type { StagedGeneratedQuestion } from '@/lib/questions/generated-question-staging'

interface BatchQuestionPreviewCardProps {
  questionNumber: string
  problemTypeName: string
  generatedQuestion: StagedGeneratedQuestion
  rating: number
  tags: string[]
  isSelected: boolean
  saveStatus: string
  saveErrorMessage?: string | null
  onRatingChange: (rating: number) => void
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  onSelectChange: (checked: boolean) => void
  onSave: () => void
  isSaving: boolean
  disableActions?: boolean
}

const saveStatusLabel: Record<string, string> = {
  unsaved: '저장 전',
  saving: '영어문제 관리에 저장 중',
  saved: '영어문제 관리에 저장됨',
  save_failed: '저장 재시도 필요',
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
  rating,
  tags,
  isSelected,
  saveStatus,
  saveErrorMessage,
  onRatingChange,
  onAddTag,
  onRemoveTag,
  onSelectChange,
  onSave,
  isSaving,
  disableActions = false,
}: BatchQuestionPreviewCardProps) {
  const isSaved = saveStatus === 'saved'

  return (
    <Card className={isSelected ? 'border-primary shadow-md ring-1 ring-primary/30' : ''}>
      <CardHeader className="gap-3 border-b bg-gray-50/80">
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <Checkbox
              aria-label={`${questionNumber}번 ${problemTypeName} 문제 선택`}
              checked={isSelected}
              disabled={disableActions || isSaved || isSaving}
              onCheckedChange={(checked) => onSelectChange(Boolean(checked))}
            />
            <div>
              <CardTitle className="text-base">{questionNumber}번 · {problemTypeName}</CardTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge className={saveStatusClassName[saveStatus] ?? saveStatusClassName.unsaved}>
                  {saveStatusLabel[saveStatus] ?? '상태 확인 필요'}
                </Badge>
                {isSaved ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    영어문제 관리에 저장됨
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <Button
            size="sm"
            onClick={onSave}
            disabled={disableActions || isSaved || isSaving}
            className="w-full sm:w-auto"
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isSaved ? '영어문제 관리에 저장됨' : '이 문제 저장'}
          </Button>
        </div>

        {saveErrorMessage ? (
          <p className="text-sm text-rose-600">{saveErrorMessage}</p>
        ) : null}
      </CardHeader>

      <CardContent className="p-6">
        <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
          <div className="flex flex-wrap items-center gap-0.5">
            {[1, 2, 3].map((star) => (
              <button
                key={star}
                type="button"
                aria-label={`별점 ${star}점 선택`}
                aria-pressed={rating === star}
                onClick={() => onRatingChange(rating === star ? 0 : star)}
                disabled={disableActions || isSaved || isSaving}
                className={`p-1 transition-colors ${
                  rating >= star
                    ? 'text-yellow-400'
                    : 'text-gray-300 hover:text-yellow-200'
                }`}
              >
                <Star className={`h-5 w-5 ${rating >= star ? 'fill-current' : ''}`} />
              </button>
            ))}
          </div>

          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-1 sm:justify-end">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="group h-6 gap-1 pl-2 pr-1 py-0.5 text-xs bg-white">
                {tag}
                {!disableActions && !isSaved && !isSaving ? (
                  <button
                    type="button"
                    aria-label={`${tag} 태그 삭제`}
                    onClick={() => onRemoveTag(tag)}
                    className="rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </Badge>
            ))}

            {!disableActions && !isSaved && !isSaving ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="태그 추가"
                    className="h-6 w-6 rounded-full border border-dashed p-0 hover:border-solid hover:bg-gray-100"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-60 p-3" align="end">
                  <div className="flex gap-2">
                    <Input
                      placeholder="태그 입력..."
                      aria-label="추가할 태그"
                      className="h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                        e.preventDefault()
                        const val = e.currentTarget.value.trim()
                        if (!val) return
                        onAddTag(val)
                        e.currentTarget.value = ''
                      }}
                    />
                  </div>
                  <p className="mt-2 text-right text-[10px] text-gray-400">엔터키를 눌러 추가</p>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        </div>

        <QuestionPreview
          question={generatedQuestion}
          showCard={false}
          showSaveButton={false}
        />
      </CardContent>
    </Card>
  )
}
