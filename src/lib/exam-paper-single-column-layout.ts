import { splitTextIntoFlowChunks } from '@/lib/exam-paper-pdf-pagination.js'
import { normalizeQuestionTextBackward } from '@/lib/questions/normalize-question-field'

export interface SingleColumnChoiceLike {
  label: string
  text: string
}

export interface SingleColumnQuestionLike {
  number: number
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices?: SingleColumnChoiceLike[] | null
  answer?: string | null
  explanation?: string | null
}

export interface SingleColumnRenderOptions {
  showQuestions: boolean
  showAnswers: boolean
}

export type SingleColumnBlockKind = 'header' | 'body' | 'choice-row' | 'answer'

export interface SingleColumnBlock {
  id: string
  questionNumber: number
  kind: SingleColumnBlockKind
  estimatedHeight: number
  payload:
    | { type: 'header'; text: string }
    | { type: 'body'; text: string; sectionKey: 'forward' | 'passage' | 'backward' }
    | { type: 'choice-row'; label: string; text: string; choiceIndex: number }
    | {
      type: 'answer'
      questionLabel?: string
      answerText?: string
      explanationText: string
      fragmentIndex: number
      fragmentCount: number
      showAnswerLabel: boolean
    }
}

export interface SingleColumnQuestionGroups {
  questionNumber: number
  promptBlocks: SingleColumnBlock[]
  choiceBlocks: SingleColumnBlock[]
  answerBlocks: SingleColumnBlock[]
  placementMode?: 'default' | 'answer-fragments'
}

export interface SingleColumnPagePlan {
  pageIndex: number
  blockIds: string[]
  blocks: SingleColumnBlock[]
}

export interface SingleColumnPlacementOptions {
  groupAnswerOnlyQuestion?: boolean
}

export type SingleColumnPlacementStep =
  | { type: 'atomic-group'; blocks: SingleColumnBlock[] }
  | { type: 'choice-rows'; blocks: SingleColumnBlock[] }
  | { type: 'answer-fragments'; blocks: SingleColumnBlock[] }

function normalizeText(text: string | null | undefined) {
  if (typeof text !== 'string') {
    return ''
  }

  return text.trim()
}

function estimateTextWeight(text: string | null | undefined, charsPerLine: number, baseWeight: number) {
  const normalized = normalizeText(text)

  if (!normalized) {
    return 0
  }

  return baseWeight + Math.max(1, Math.ceil(normalized.length / charsPerLine))
}

function createHeaderBlock(question: SingleColumnQuestionLike, showQuestions: boolean): SingleColumnBlock {
  return {
    id: `question-${question.number}-header`,
    questionNumber: question.number,
    kind: 'header',
    estimatedHeight: estimateTextWeight(showQuestions ? question.questionText : `${question.number}번`, 72, 4),
    payload: {
      type: 'header',
      text: showQuestions ? question.questionText : `${question.number}번`,
    },
  }
}

function createBodyBlock(
  question: SingleColumnQuestionLike,
  sectionKey: 'forward' | 'passage' | 'backward',
  text: string
): SingleColumnBlock {
  return {
    id: `question-${question.number}-${sectionKey}`,
    questionNumber: question.number,
    kind: 'body',
    estimatedHeight: estimateTextWeight(text, 84, 6),
    payload: {
      type: 'body',
      text,
      sectionKey,
    },
  }
}

function createChoiceRowBlock(
  question: SingleColumnQuestionLike,
  choice: SingleColumnChoiceLike,
  index: number
): SingleColumnBlock {
  return {
    id: `question-${question.number}-choice-row-${index + 1}`,
    questionNumber: question.number,
    kind: 'choice-row',
    estimatedHeight: estimateTextWeight(`${choice.label} ${choice.text}`, 80, 1),
    payload: {
      type: 'choice-row',
      label: choice.label,
      text: choice.text,
      choiceIndex: index,
    },
  }
}

function buildAnswerBlockId(questionNumber: number, fragmentIndex: number, fragmentCount: number) {
  return fragmentCount <= 1
    ? `question-${questionNumber}-answer`
    : `question-${questionNumber}-answer-part-${fragmentIndex + 1}`
}

function createAnswerBlocks(
  question: SingleColumnQuestionLike,
  { splitExplanation = false }: { splitExplanation?: boolean } = {}
): SingleColumnBlock[] {
  const answerText = normalizeText(question.answer)
  const explanationText = normalizeText(question.explanation)
  const questionLabel = `${question.number}번`

  if (!answerText && !explanationText) {
    return []
  }

  const explanationChunks = splitExplanation && explanationText
    ? splitTextIntoFlowChunks(explanationText, 320)
    : []
  const chunks = explanationChunks.length > 0 ? explanationChunks : [explanationText]
  const fragmentCount = chunks.length

  return chunks.map((chunk, index) => {
    const isFirstFragment = index === 0

    return {
      id: buildAnswerBlockId(question.number, index, fragmentCount),
      questionNumber: question.number,
      kind: 'answer',
      estimatedHeight: estimateTextWeight(isFirstFragment ? questionLabel : '', 72, isFirstFragment ? 1 : 0)
        + estimateTextWeight(isFirstFragment ? answerText : '', 84, isFirstFragment ? 1 : 0)
        + estimateTextWeight(chunk, 90, isFirstFragment ? 3 : 1),
      payload: {
        type: 'answer',
        questionLabel: isFirstFragment ? questionLabel : '',
        answerText: isFirstFragment ? answerText : '',
        explanationText: chunk,
        fragmentIndex: index,
        fragmentCount,
        showAnswerLabel: isFirstFragment,
      },
    }
  })
}

export function buildSingleColumnQuestionGroups(
  question: SingleColumnQuestionLike,
  options: SingleColumnRenderOptions
): SingleColumnQuestionGroups {
  const promptBlocks: SingleColumnBlock[] = []
  const choiceBlocks: SingleColumnBlock[] = []
  const answerBlocks: SingleColumnBlock[] = []

  if (options.showQuestions) {
    promptBlocks.push(createHeaderBlock(question, true))

    const forwardText = normalizeText(question.questionTextForward)
    if (forwardText) {
      promptBlocks.push(createBodyBlock(question, 'forward', forwardText))
    }

    const passageText = normalizeText(question.passageText)
    if (passageText) {
      promptBlocks.push(createBodyBlock(question, 'passage', passageText))
    }

    const backwardText = normalizeQuestionTextBackward(question.questionTextBackward)
    if (backwardText) {
      promptBlocks.push(createBodyBlock(question, 'backward', backwardText))
    }

    if (Array.isArray(question.choices)) {
      question.choices.forEach((choice, index) => {
        choiceBlocks.push(createChoiceRowBlock(question, choice, index))
      })
    }
  } else if (!options.showAnswers) {
    promptBlocks.push(createHeaderBlock(question, false))
  }

  if (options.showAnswers) {
    answerBlocks.push(...createAnswerBlocks(question, {
      splitExplanation: !options.showQuestions,
    }))
  }

  return {
    questionNumber: question.number,
    promptBlocks,
    choiceBlocks,
    answerBlocks,
  }
}

export function buildSingleColumnExamWithAnswersSeparatedGroups(
  questions: SingleColumnQuestionLike[]
): SingleColumnQuestionGroups[] {
  const questionGroups = questions.map((question) => (
    buildSingleColumnQuestionGroups(question, {
      showQuestions: true,
      showAnswers: false,
    })
  ))

  const answerGroups = questions.map((question) => ({
    ...buildSingleColumnQuestionGroups(question, {
      showQuestions: false,
      showAnswers: true,
    }),
    placementMode: 'answer-fragments' as const,
  }))

  return [...questionGroups, ...answerGroups]
}

export function buildSingleColumnPlacementSteps(
  group: SingleColumnQuestionGroups,
  { groupAnswerOnlyQuestion = false }: SingleColumnPlacementOptions = {}
): SingleColumnPlacementStep[] {
  if (group.placementMode === 'answer-fragments' || groupAnswerOnlyQuestion) {
    return [{
      type: 'answer-fragments',
      blocks: group.answerBlocks,
    }]
  }

  return [
    { type: 'atomic-group', blocks: group.promptBlocks },
    { type: 'choice-rows', blocks: group.choiceBlocks },
    { type: 'atomic-group', blocks: group.answerBlocks },
  ]
}

function getPageCapacity(
  pageIndex: number,
  {
    hasDescription,
    firstPageCapacity,
    otherPageCapacity,
  }: {
    hasDescription: boolean
    firstPageCapacity?: number
    otherPageCapacity?: number
  }
) {
  if (pageIndex === 0) {
    return firstPageCapacity ?? (hasDescription ? 78 : 88)
  }

  return otherPageCapacity ?? 96
}

export function paginateSingleColumnQuestionGroups({
  questionGroups,
  hasDescription,
  firstPageCapacity,
  otherPageCapacity,
  groupAnswerOnlyQuestion = false,
}: {
  questionGroups: SingleColumnQuestionGroups[]
  hasDescription: boolean
  firstPageCapacity?: number
  otherPageCapacity?: number
  groupAnswerOnlyQuestion?: boolean
}): SingleColumnPagePlan[] {
  const pages: SingleColumnPagePlan[] = []
  const usage: number[] = []

  const ensurePage = (pageIndex: number) => {
    if (!pages[pageIndex]) {
      pages[pageIndex] = {
        pageIndex,
        blockIds: [],
        blocks: [],
      }
      usage[pageIndex] = 0
    }
  }

  let pageIndex = 0
  ensurePage(pageIndex)

  const moveToNextPage = () => {
    pageIndex += 1
    ensurePage(pageIndex)
  }

  const placeGroup = (blocks: SingleColumnBlock[]) => {
    if (blocks.length === 0) {
      return
    }

    const groupWeight = blocks.reduce((sum, block) => sum + block.estimatedHeight, 0)
    const capacity = getPageCapacity(pageIndex, { hasDescription, firstPageCapacity, otherPageCapacity })

    if (usage[pageIndex] > 0 && usage[pageIndex] + groupWeight > capacity) {
      moveToNextPage()
    }

    blocks.forEach((block) => {
      pages[pageIndex].blocks.push(block)
      pages[pageIndex].blockIds.push(block.id)
      usage[pageIndex] += block.estimatedHeight
    })
  }

  const placeChoiceBlocks = (blocks: SingleColumnBlock[]) => {
    blocks.forEach((block) => {
      const capacity = getPageCapacity(pageIndex, { hasDescription, firstPageCapacity, otherPageCapacity })

      if (usage[pageIndex] > 0 && usage[pageIndex] + block.estimatedHeight > capacity) {
        moveToNextPage()
      }

      pages[pageIndex].blocks.push(block)
      pages[pageIndex].blockIds.push(block.id)
      usage[pageIndex] += block.estimatedHeight
    })
  }

  questionGroups.forEach((group) => {
    buildSingleColumnPlacementSteps(group, {
      groupAnswerOnlyQuestion,
    }).forEach((step) => {
      if (step.type === 'atomic-group') {
        placeGroup(step.blocks)
        return
      }

      if (step.type === 'answer-fragments') {
        placeChoiceBlocks(step.blocks)
        return
      }

      placeChoiceBlocks(step.blocks)
    })
  })

  return pages.filter((page) => page.blocks.length > 0)
}
