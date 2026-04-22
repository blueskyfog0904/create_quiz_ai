import { paginateTwoColumnQuestionChunks, splitTextIntoFlowChunks } from '@/lib/exam-paper-pdf-pagination.js'
import { normalizeQuestionTextBackward } from '@/lib/questions/normalize-question-field'

export type ExamPaperLayoutViewMode = 'exam-only' | 'answer-only' | 'exam-with-answers'
export type ExamPaperLayoutColumnLayout = 'single' | 'double'
export type ExamPaperLayoutChunkKind = 'header' | 'body' | 'choice' | 'answer' | 'explanation'
export type TwoColumnLayoutTarget = 'preview' | 'pdf'
export type TwoColumnLayoutProfileName = 'shared-default'
export type TwoColumnSectionKind = 'header' | 'body' | 'choice' | 'answer'

export interface ExamPaperLayoutInput {
  viewMode?: ExamPaperLayoutViewMode
  includeAnswers?: boolean
  columnLayout?: ExamPaperLayoutColumnLayout
}

export interface ExamPaperRenderOptions {
  viewMode: ExamPaperLayoutViewMode
  columnLayout: ExamPaperLayoutColumnLayout
  showQuestions: boolean
  showAnswers: boolean
  isDoubleColumn: boolean
  titleSuffix: string
  layoutSuffix: string
}

export interface ExamPaperSectionChunk<TPayload> {
  id: string
  estimatedHeight: number
  kind: ExamPaperLayoutChunkKind
  payload: TPayload
}

export interface ExamPaperQuestionPlan<TPayload> {
  questionNumber: number
  sections: ExamPaperSectionChunk<TPayload>[]
}

export interface ExamPaperColumnPlan<TPayload> {
  columnIndex: number
  sectionIds: string[]
  sections: ExamPaperSectionChunk<TPayload>[]
}

export interface ExamPaperPagePlan<TPayload> {
  pageIndex: number
  pageId: string
  columns: [ExamPaperColumnPlan<TPayload>, ExamPaperColumnPlan<TPayload>]
}

export interface ExamPaperLayoutPlan<TPagePayload, TQuestionPayload = TPagePayload> {
  viewMode: ExamPaperLayoutViewMode
  columnLayout: ExamPaperLayoutColumnLayout
  pages: ExamPaperPagePlan<TPagePayload>[]
  questions: ExamPaperQuestionPlan<TQuestionPayload>[]
}

export interface TwoColumnLayoutChoiceLike {
  label: string
  text: string
}

export interface TwoColumnLayoutQuestionLike {
  number: number
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices?: TwoColumnLayoutChoiceLike[] | null
  answer?: string | null
  explanation?: string | null
}

export interface TwoColumnSectionPlan {
  id: string
  questionNumber: number
  kind: TwoColumnSectionKind
  sectionKey: string
  estimatedUnits: number
  text?: string
  choiceRows?: TwoColumnLayoutChoiceLike[]
  answerText?: string
  explanationText?: string
  questionLabel?: string
  allowContinuation?: boolean
}

export interface TwoColumnQuestionSectionPlan {
  questionNumber: number
  sections: TwoColumnSectionPlan[]
}

export type TwoColumnContinuationPosition = 'single' | 'start' | 'middle' | 'end'

export interface TwoColumnHeaderFragmentPayload {
  type: 'header'
  text: string
}

export interface TwoColumnBodyFragmentPayload {
  type: 'body'
  text: string
}

export interface TwoColumnChoiceFragmentPayload {
  type: 'choice'
  rows: TwoColumnLayoutChoiceLike[]
  choiceStartIndex: number
  choiceEndIndex: number
}

export interface TwoColumnAnswerFragmentPayload {
  type: 'answer'
  questionLabel?: string
  answerText?: string
  explanationText?: string
  explanationChunkIndex?: number
  explanationChunkCount?: number
  showAnswerLabel: boolean
}

export type TwoColumnFragmentPayload =
  | TwoColumnHeaderFragmentPayload
  | TwoColumnBodyFragmentPayload
  | TwoColumnChoiceFragmentPayload
  | TwoColumnAnswerFragmentPayload

export interface TwoColumnFragmentPlan {
  id: string
  sourceSectionId: string
  questionNumber: number
  kind: TwoColumnSectionKind
  sectionKey: string
  continuationPosition: TwoColumnContinuationPosition
  fragmentIndex: number
  estimatedUnits: number
  splittable: boolean
  payload: TwoColumnFragmentPayload
}

export interface BuildTwoColumnLayoutPlanInput {
  questionPlans: TwoColumnQuestionSectionPlan[]
  profile?: TwoColumnLayoutProfileName
  target?: TwoColumnLayoutTarget
  hasDescription?: boolean
}

interface ResolvedTwoColumnLayoutProfile {
  firstPageSlotCapacity: number
  otherPageSlotCapacity: number
  promptSpreadSlotCapacity: number
}

const DEFAULT_COMPAT_LAYOUT_PROFILE_NAME: TwoColumnLayoutProfileName = 'shared-default'
const DEFAULT_COMPAT_LAYOUT_TARGET: TwoColumnLayoutTarget = 'preview'
const DOUBLE_COLUMN_BOTTOM_GUARD_BAND_UNITS = 50

const BODY_SECTION_DEFINITIONS = [
  {
    sectionKey: 'forward',
    resolveText: (question: TwoColumnLayoutQuestionLike) => question.questionTextForward,
  },
  {
    sectionKey: 'passage',
    resolveText: (question: TwoColumnLayoutQuestionLike) => question.passageText,
  },
  {
    sectionKey: 'backward',
    resolveText: (question: TwoColumnLayoutQuestionLike) =>
      normalizeQuestionTextBackward(question.questionTextBackward),
  },
] as const

const SHARED_TWO_COLUMN_LAYOUT_PROFILES: Record<
  TwoColumnLayoutProfileName,
  {
    descriptionPenalty: number
    targets: Record<TwoColumnLayoutTarget, ResolvedTwoColumnLayoutProfile>
  }
> = {
  'shared-default': {
    descriptionPenalty: 80,
    targets: {
      preview: {
        firstPageSlotCapacity: 1200,
        otherPageSlotCapacity: 1280,
        promptSpreadSlotCapacity: 780,
      },
      pdf: {
        firstPageSlotCapacity: 1200,
        otherPageSlotCapacity: 1280,
        promptSpreadSlotCapacity: 780,
      },
    },
  },
}

function normalizeSectionText(text: string | null | undefined) {
  if (typeof text !== 'string') {
    return ''
  }

  return text.trim()
}

function countEstimatedLines(text: string, charsPerLine: number) {
  return text
    .split('\n')
    .reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(line.trim().length / charsPerLine)),
      0
    )
}

function estimateSectionUnits(
  text: string | null | undefined,
  {
    charsPerLine,
    lineUnit,
    baseUnit,
  }: {
    charsPerLine: number
    lineUnit: number
    baseUnit: number
  }
) {
  const normalized = normalizeSectionText(text)

  if (!normalized) {
    return 0
  }

  return baseUnit + (countEstimatedLines(normalized, charsPerLine) * lineUnit)
}

function getContinuationPosition(
  index: number,
  totalCount: number
): TwoColumnContinuationPosition {
  if (totalCount <= 1) {
    return 'single'
  }

  if (index === 0) {
    return 'start'
  }

  if (index === totalCount - 1) {
    return 'end'
  }

  return 'middle'
}

function buildFragmentId(sourceSectionId: string, index: number, totalCount: number) {
  return totalCount <= 1 ? sourceSectionId : `${sourceSectionId}-part-${index + 1}`
}

function buildChoiceRowText(choice: TwoColumnLayoutChoiceLike) {
  return `${choice.label}${choice.text}`
}

function estimateChoiceFragmentUnits(
  rows: TwoColumnLayoutChoiceLike[],
  continuationPosition: TwoColumnContinuationPosition
) {
  return estimateSectionUnits(rows.map(buildChoiceRowText).join('\n'), {
    charsPerLine: 34,
    lineUnit: 22,
    baseUnit: continuationPosition === 'single' ? 52 : 10,
  })
}

function estimateAnswerFragmentUnits(
  {
    questionLabel,
    answerText,
    explanationText,
  }: {
    questionLabel?: string
    answerText?: string
    explanationText?: string
  },
  continuationPosition: TwoColumnContinuationPosition
) {
  return estimateSectionUnits(
    [questionLabel, answerText ? `정답: ${answerText}` : '', explanationText].filter(Boolean).join('\n'),
    {
      charsPerLine: 34,
      lineUnit: 22,
      baseUnit: continuationPosition === 'single' || continuationPosition === 'start' ? 30 : 6,
    }
  )
}


function createSingleFragmentFromSection(section: TwoColumnSectionPlan): TwoColumnFragmentPlan {
  if (section.kind === 'header') {
    return {
      id: section.id,
      sourceSectionId: section.id,
      questionNumber: section.questionNumber,
      kind: section.kind,
      sectionKey: section.sectionKey,
      continuationPosition: 'single',
      fragmentIndex: 0,
      estimatedUnits: section.estimatedUnits,
      splittable: false,
      payload: {
        type: 'header',
        text: section.text ?? '',
      },
    }
  }

  if (section.kind === 'body') {
    return {
      id: section.id,
      sourceSectionId: section.id,
      questionNumber: section.questionNumber,
      kind: section.kind,
      sectionKey: section.sectionKey,
      continuationPosition: 'single',
      fragmentIndex: 0,
      estimatedUnits: section.estimatedUnits,
      splittable: true,
      payload: {
        type: 'body',
        text: section.text ?? '',
      },
    }
  }

  if (section.kind === 'choice') {
    return {
      id: section.id,
      sourceSectionId: section.id,
      questionNumber: section.questionNumber,
      kind: section.kind,
      sectionKey: section.sectionKey,
      continuationPosition: 'single',
      fragmentIndex: 0,
      estimatedUnits: section.estimatedUnits,
      splittable: true,
      payload: {
        type: 'choice',
        rows: section.choiceRows ?? [],
        choiceStartIndex: 0,
        choiceEndIndex: Math.max(0, (section.choiceRows?.length ?? 1) - 1),
      },
    }
  }

  return {
    id: section.id,
    sourceSectionId: section.id,
    questionNumber: section.questionNumber,
    kind: section.kind,
    sectionKey: section.sectionKey,
    continuationPosition: 'single',
    fragmentIndex: 0,
    estimatedUnits: section.estimatedUnits,
    splittable: true,
    payload: {
      type: 'answer',
      questionLabel: section.questionLabel,
      answerText: section.answerText,
      explanationText: section.explanationText,
      explanationChunkIndex: section.explanationText ? 1 : undefined,
      explanationChunkCount: section.explanationText ? 1 : undefined,
      showAnswerLabel: true,
    },
  }
}

function createChoiceFragments(section: TwoColumnSectionPlan) {
  const choiceRows = section.choiceRows ?? []

  if (choiceRows.length <= 1) {
    return [createSingleFragmentFromSection(section)]
  }

  return choiceRows.map((choiceRow, index) => {
    const continuationPosition = getContinuationPosition(index, choiceRows.length)

    return {
      id: buildFragmentId(section.id, index, choiceRows.length),
      sourceSectionId: section.id,
      questionNumber: section.questionNumber,
      kind: section.kind,
      sectionKey: section.sectionKey,
      continuationPosition,
      fragmentIndex: index,
      estimatedUnits: estimateChoiceFragmentUnits([choiceRow], continuationPosition),
      splittable: true,
      payload: {
        type: 'choice',
        rows: [choiceRow],
        choiceStartIndex: index,
        choiceEndIndex: index,
      },
    } satisfies TwoColumnFragmentPlan
  })
}

function createAnswerFragments(section: TwoColumnSectionPlan) {
  const explanationChunks = splitTextIntoFlowChunks(section.explanationText ?? '', 220)
  const chunks = explanationChunks.length > 0
    ? explanationChunks
    : [section.explanationText ?? '']
  const fragmentCount = chunks.length

  return chunks.map((explanationChunk, index) => {
    const continuationPosition = getContinuationPosition(index, fragmentCount)
    const isFirstFragment = index === 0

    return {
      id: buildFragmentId(section.id, index, fragmentCount),
      sourceSectionId: section.id,
      questionNumber: section.questionNumber,
      kind: section.kind,
      sectionKey: section.sectionKey,
      continuationPosition,
      fragmentIndex: index,
      estimatedUnits: estimateAnswerFragmentUnits({
        questionLabel: isFirstFragment ? section.questionLabel : '',
        answerText: isFirstFragment ? section.answerText : '',
        explanationText: explanationChunk,
      }, continuationPosition),
      splittable: true,
      payload: {
        type: 'answer',
        questionLabel: isFirstFragment ? section.questionLabel : '',
        answerText: isFirstFragment ? section.answerText : '',
        explanationText: explanationChunk,
        explanationChunkIndex: index + 1,
        explanationChunkCount: fragmentCount,
        showAnswerLabel: isFirstFragment,
      },
    } satisfies TwoColumnFragmentPlan
  })
}

function buildSectionFragments(section: TwoColumnSectionPlan) {
  if (section.kind === 'choice') {
    return createChoiceFragments(section)
  }

  if (section.kind === 'answer' && section.allowContinuation) {
    return createAnswerFragments(section)
  }

  return [createSingleFragmentFromSection(section)]
}

function toLayoutFragment(
  fragment: TwoColumnFragmentPlan
): ExamPaperSectionChunk<TwoColumnFragmentPlan> {
  return {
    id: fragment.id,
    estimatedHeight: fragment.estimatedUnits,
    kind: fragment.kind,
    payload: fragment,
  }
}

function toFragmentQuestionPlan(
  questionPlan: TwoColumnQuestionSectionPlan
): ExamPaperQuestionPlan<TwoColumnFragmentPlan> {
  return {
    questionNumber: questionPlan.questionNumber,
    sections: questionPlan.sections.flatMap((section) => (
      buildSectionFragments(section).map(toLayoutFragment)
    )),
  }
}

function resolveTwoColumnLayoutProfile(
  profileName: TwoColumnLayoutProfileName = 'shared-default',
  target: TwoColumnLayoutTarget = 'preview',
  hasDescription = false
): ResolvedTwoColumnLayoutProfile {
  const profile = SHARED_TWO_COLUMN_LAYOUT_PROFILES[profileName] ??
    SHARED_TWO_COLUMN_LAYOUT_PROFILES['shared-default']
  const resolvedTargetProfile = profile.targets[target] ?? profile.targets.preview
  const descriptionPenalty = hasDescription ? profile.descriptionPenalty : 0

  return {
    firstPageSlotCapacity: resolvedTargetProfile.firstPageSlotCapacity - descriptionPenalty,
    otherPageSlotCapacity: resolvedTargetProfile.otherPageSlotCapacity,
    promptSpreadSlotCapacity: resolvedTargetProfile.promptSpreadSlotCapacity - descriptionPenalty,
  }
}

function toLayoutSection(section: TwoColumnSectionPlan): ExamPaperSectionChunk<TwoColumnSectionPlan> {
  return {
    id: section.id,
    estimatedHeight: section.estimatedUnits,
    kind: section.kind,
    payload: section,
  }
}

function toLayoutQuestionPlan(
  questionPlan: TwoColumnQuestionSectionPlan
): ExamPaperQuestionPlan<TwoColumnSectionPlan> {
  return {
    questionNumber: questionPlan.questionNumber,
    sections: questionPlan.sections.map(toLayoutSection),
  }
}

function hasAnswerSections(questionPlan: TwoColumnQuestionSectionPlan) {
  return questionPlan.sections.some((section) => section.kind === 'answer')
}

export function buildExamPaperRenderOptions(examPaper: ExamPaperLayoutInput): ExamPaperRenderOptions {
  const viewMode: ExamPaperLayoutViewMode = examPaper.viewMode ||
    (examPaper.includeAnswers === false ? 'exam-only' : 'exam-with-answers')
  const columnLayout: ExamPaperLayoutColumnLayout = examPaper.columnLayout || 'single'

  return {
    viewMode,
    columnLayout,
    showQuestions: viewMode !== 'answer-only',
    showAnswers: viewMode !== 'exam-only',
    isDoubleColumn: columnLayout === 'double',
    titleSuffix: viewMode === 'answer-only'
      ? ' - 답안'
      : viewMode === 'exam-only'
        ? ' - 시험지'
        : '',
    layoutSuffix: columnLayout === 'double' ? ' (2단)' : '',
  }
}

export function buildQuestionSectionPlan(
  question: TwoColumnLayoutQuestionLike,
  options: ExamPaperRenderOptions
): TwoColumnQuestionSectionPlan {
  const sections: TwoColumnSectionPlan[] = []

  if (options.showQuestions) {
    sections.push({
      id: `question-${question.number}-header`,
      questionNumber: question.number,
      kind: 'header',
      sectionKey: 'header',
      estimatedUnits: estimateSectionUnits(question.questionText, {
        charsPerLine: 34,
        lineUnit: 25,
        baseUnit: 28,
      }),
      text: normalizeSectionText(question.questionText),
    })

    BODY_SECTION_DEFINITIONS.forEach(({ sectionKey, resolveText }) => {
      const bodyText = normalizeSectionText(resolveText(question))

      if (!bodyText) {
        return
      }

      sections.push({
        id: `question-${question.number}-${sectionKey}`,
        questionNumber: question.number,
        kind: 'body',
        sectionKey,
        estimatedUnits: estimateSectionUnits(bodyText, {
          charsPerLine: 38,
          lineUnit: 23,
          baseUnit: 42,
        }),
        text: bodyText,
      })
    })

    if (Array.isArray(question.choices) && question.choices.length > 0) {
      const choiceText = question.choices
        .map((choice) => `${choice.label}${choice.text}`)
        .join('\n')

      sections.push({
        id: `question-${question.number}-choice`,
        questionNumber: question.number,
        kind: 'choice',
        sectionKey: 'choice',
        estimatedUnits: estimateSectionUnits(choiceText, {
          charsPerLine: 34,
          lineUnit: 22,
          baseUnit: 52,
        }),
        text: choiceText,
        choiceRows: question.choices,
      })
    }
  }

  if (options.showAnswers) {
    const answerText = normalizeSectionText(question.answer)
    const explanationText = normalizeSectionText(question.explanation)
    const questionLabel = `${question.number}번`
    const combinedAnswerText = [answerText, explanationText].filter(Boolean).join('\n')
    const estimatedAnswerText = [questionLabel, combinedAnswerText]
      .filter(Boolean)
      .join('\n')

    if (combinedAnswerText) {
      sections.push({
        id: `question-${question.number}-answer`,
        questionNumber: question.number,
        kind: 'answer',
        sectionKey: 'answer',
        estimatedUnits: estimateSectionUnits(estimatedAnswerText, {
          charsPerLine: 40,
          lineUnit: 22,
          baseUnit: 72,
        }),
        text: combinedAnswerText,
        answerText,
        explanationText,
        questionLabel,
        allowContinuation: options.viewMode === 'answer-only',
      })
    }
  }

  return {
    questionNumber: question.number,
    sections,
  }
}

export function buildTwoColumnLayoutPlan({
  questionPlans,
  profile = 'shared-default',
  target = 'preview',
  hasDescription = false,
}: BuildTwoColumnLayoutPlanInput): ExamPaperLayoutPlan<
  TwoColumnFragmentPlan,
  TwoColumnSectionPlan
> {
  const includeAnswers = questionPlans.some(hasAnswerSections)
  const resolvedProfile = resolveTwoColumnLayoutProfile(profile, target, hasDescription)
  const firstPageSlotCapacity = Math.max(
    0,
    resolvedProfile.firstPageSlotCapacity - DOUBLE_COLUMN_BOTTOM_GUARD_BAND_UNITS
  )
  const otherPageSlotCapacity = Math.max(
    0,
    resolvedProfile.otherPageSlotCapacity - DOUBLE_COLUMN_BOTTOM_GUARD_BAND_UNITS
  )
  const layoutPlan = buildExamPaperLayoutPlan<TwoColumnFragmentPlan>({
    questionPlans: questionPlans.map(toFragmentQuestionPlan),
    viewMode: includeAnswers ? 'exam-with-answers' : 'exam-only',
    columnLayout: 'double',
    firstPageSlotCapacity,
    otherPageSlotCapacity,
  })

  return {
    viewMode: includeAnswers ? 'exam-with-answers' : 'exam-only',
    columnLayout: 'double',
    questions: questionPlans.map(toLayoutQuestionPlan),
    pages: layoutPlan.pages,
  }
}

export function buildExamPaperLayoutPlan<TPayload>({
  questionPlans,
  viewMode,
  columnLayout,
  firstPageSlotCapacity,
  otherPageSlotCapacity,
  slotCapacity,
}: {
  questionPlans: ExamPaperQuestionPlan<TPayload>[]
  viewMode: ExamPaperLayoutViewMode
  columnLayout: ExamPaperLayoutColumnLayout
  firstPageSlotCapacity?: number
  otherPageSlotCapacity?: number
  slotCapacity?: number
}): ExamPaperLayoutPlan<TPayload> {
  if (columnLayout !== 'double') {
    return {
      viewMode,
      columnLayout,
      questions: questionPlans,
      pages: [],
    }
  }

  // Compatibility wrapper default: when legacy callers omit capacities, preserve
  // the shared-default preview baseline rather than silently inferring a new lane.
  const fallbackProfile = resolveTwoColumnLayoutProfile(
    DEFAULT_COMPAT_LAYOUT_PROFILE_NAME,
    DEFAULT_COMPAT_LAYOUT_TARGET,
    false
  )
  const resolvedFirstPageCapacity = typeof firstPageSlotCapacity === 'number'
    ? firstPageSlotCapacity
    : fallbackProfile.firstPageSlotCapacity
  const resolvedOtherPageCapacity = typeof otherPageSlotCapacity === 'number'
    ? otherPageSlotCapacity
    : fallbackProfile.otherPageSlotCapacity
  const paginatedPages = paginateTwoColumnQuestionChunks(
    questionPlans.map((questionPlan) => ({
      questionNumber: questionPlan.questionNumber,
      chunks: questionPlan.sections.map((section) => ({
        ...section,
        node: section.payload,
      })),
    })),
    {
      slotCapacity,
      firstPageSlotCapacity: resolvedFirstPageCapacity,
      otherPageSlotCapacity: resolvedOtherPageCapacity,
    }
  )

  return {
    viewMode,
    columnLayout,
    questions: questionPlans,
    pages: paginatedPages.map((page, pageIndex) => ({
      pageIndex,
      pageId: `page-${pageIndex + 1}`,
      columns: [
        {
          columnIndex: 0,
          sectionIds: page.left.map((section) => section.id),
          sections: page.left.map((section) => ({
            id: section.id,
            estimatedHeight: section.estimatedHeight,
            kind: section.kind as ExamPaperLayoutChunkKind,
            payload: section.node as TPayload,
          })),
        },
        {
          columnIndex: 1,
          sectionIds: page.right.map((section) => section.id),
          sections: page.right.map((section) => ({
            id: section.id,
            estimatedHeight: section.estimatedHeight,
            kind: section.kind as ExamPaperLayoutChunkKind,
            payload: section.node as TPayload,
          })),
        },
      ],
    })),
  }
}
