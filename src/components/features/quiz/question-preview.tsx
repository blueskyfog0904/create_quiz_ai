import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { normalizeQuestionTextBackward } from '@/lib/questions/normalize-question-field'
import { InlineBracketUnderlineText } from '@/components/features/quiz/InlineBracketUnderlineText'

type PreviewQuestion = {
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices?: unknown
  answer?: string
  explanation?: string | null
  question_text?: string
  question_text_forward?: string | null
  question_text_backward?: string | null
  passage_text?: string | null
}

interface QuestionPreviewProps {
  question: PreviewQuestion
  onSave?: () => void
  isSaving?: boolean
  showSaveButton?: boolean
  title?: string
  showCard?: boolean
}

const defaultChoiceLabels = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

function normalizeQuestionText(question: PreviewQuestion) {
  return {
    questionText: question.questionText ?? question.question_text ?? '',
    questionTextForward: question.questionTextForward ?? question.question_text_forward ?? null,
    questionTextBackward: normalizeQuestionTextBackward(
      question.questionTextBackward ?? question.question_text_backward ?? null
    ),
    passageText: question.passageText ?? question.passage_text ?? null,
  }
}

function getChoices(question: PreviewQuestion): Array<{
  label: string
  text: string
}> {
  const rawChoices = Array.isArray(question.choices) ? question.choices : []

  if (!Array.isArray(rawChoices) || rawChoices.length === 0) {
    return []
  }

  return rawChoices.map((choice, index) => {
    if (typeof choice === 'string') {
      return {
        label: defaultChoiceLabels[index] || `${index + 1}`,
        text: choice,
      }
    }

    if (choice && typeof choice === 'object') {
      const labeled = (choice as { label?: unknown }).label
      const text = (choice as { text?: unknown }).text

      return {
        label: typeof labeled === 'string' && labeled.trim() ? labeled : (defaultChoiceLabels[index] || `${index + 1}`),
        text: typeof text === 'string' ? text : '',
      }
    }

    return {
      label: defaultChoiceLabels[index] || `${index + 1}`,
      text: '',
    }
  })
}

export function QuestionPreview({
  question,
  onSave,
  isSaving,
  showSaveButton = true,
  title = '문제 미리보기',
  showCard = true,
}: QuestionPreviewProps) {
  const normalized = normalizeQuestionText(question)
  const choices = getChoices(question)
  const content = (
    <div className="space-y-6">
      {/* Question Text */}
      <div className="space-y-2">
        <Label className="text-muted-foreground font-semibold">문제</Label>
        <InlineBracketUnderlineText
          text={normalized.questionText}
          className="p-4 bg-white rounded-md border text-lg font-medium whitespace-pre-wrap"
          noUnderline
        />
      </div>

      {/* Question Text Forward (if exists) */}
      {normalized.questionTextForward && (
        <div className="space-y-2">
          <Label className="text-muted-foreground font-semibold">주어진 문장</Label>
          <InlineBracketUnderlineText
            text={normalized.questionTextForward}
            className="p-4 bg-amber-50 rounded-md border border-amber-200 text-gray-800 whitespace-pre-wrap"
          />
        </div>
      )}

      {/* Passage Text (if exists) */}
      {normalized.passageText && (
        <div className="space-y-2">
          <Label className="text-muted-foreground font-semibold">지문</Label>
          <InlineBracketUnderlineText
            text={normalized.passageText}
            className="p-4 bg-gray-50 rounded-md border border-gray-200 text-gray-800 whitespace-pre-wrap leading-relaxed"
          />
        </div>
      )}

      {/* Question Text Backward (if exists) */}
      {normalized.questionTextBackward && (
        <div className="space-y-2">
          <Label className="text-muted-foreground font-semibold">추가 지문</Label>
          <InlineBracketUnderlineText
            text={normalized.questionTextBackward}
            className="p-4 bg-amber-50 rounded-md border border-amber-200 text-gray-800 whitespace-pre-wrap"
          />
        </div>
      )}

      {/* Choices */}
      <div className="space-y-2">
        <Label className="text-muted-foreground font-semibold">선택지</Label>
        <div className="grid gap-2">
          {choices.length > 0 ? (
            choices.map((choice, index) => (
              <div key={index} className="flex items-start p-3 rounded-md border hover:bg-gray-50 bg-white">
                <span className="font-bold mr-3 min-w-[24px]">{choice.label}</span>
                <span>{choice.text}</span>
              </div>
            ))
          ) : (
            <div className="p-3 text-gray-400 text-sm italic">선택지 없음</div>
          )}
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
            {question.explanation || '-'}
          </div>
        </div>
      </div>
    </div>
  )

  if (!showCard) {
    return content
  }

  return (
    <Card className="w-full border-2 border-primary/20 shadow-lg">
      <CardHeader className="bg-gray-50">
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg">{title}</CardTitle>
          {showSaveButton && onSave && (
            <Button onClick={onSave} disabled={isSaving}>
              {isSaving ? '저장 중...' : '문제 은행에 저장'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-6">{content}</CardContent>
    </Card>
  )
}
