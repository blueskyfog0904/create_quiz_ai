import type { Question } from '@/lib/ai/types'
import type { Json } from '@/types/supabase'

export interface StagedGeneratedQuestion {
  questionText: string
  questionTextForward: string | null
  questionTextBackward: string | null
  passageText: string | null
  choices: Array<{
    label: string
    text: string
  }>
  answer: string
  explanation: string | null
}

export const toStagedGeneratedQuestion = (question: Question): StagedGeneratedQuestion => ({
  questionText: question.questionText,
  questionTextForward: question.questionTextForward ?? null,
  questionTextBackward: question.questionTextBackward ?? null,
  passageText: question.passageText ?? null,
  choices: question.choices.map((choice) => ({
    label: choice.label,
    text: choice.text,
  })),
  answer: question.answer,
  explanation: question.explanation ?? null,
})

export const stagedGeneratedQuestionToJson = (question: Question): Json => (
  toStagedGeneratedQuestion(question) as unknown as Json
)

export const parseStagedGeneratedQuestion = (value: Json | null): StagedGeneratedQuestion | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const rawChoices = Array.isArray(record.choices) ? record.choices : null

  if (
    typeof record.questionText !== 'string' ||
    rawChoices === null ||
    typeof record.answer !== 'string'
  ) {
    return null
  }

  const choices = rawChoices
    .map((choice) => {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
        return null
      }

      const choiceRecord = choice as Record<string, unknown>
      if (typeof choiceRecord.label !== 'string' || typeof choiceRecord.text !== 'string') {
        return null
      }

      return {
        label: choiceRecord.label,
        text: choiceRecord.text,
      }
    })
    .filter((choice): choice is { label: string; text: string } => choice !== null)

  return {
    questionText: record.questionText,
    questionTextForward: typeof record.questionTextForward === 'string' ? record.questionTextForward : null,
    questionTextBackward: typeof record.questionTextBackward === 'string' ? record.questionTextBackward : null,
    passageText: typeof record.passageText === 'string' ? record.passageText : null,
    choices,
    answer: record.answer,
    explanation: typeof record.explanation === 'string' ? record.explanation : null,
  }
}
