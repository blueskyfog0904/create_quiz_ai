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
  allowContinuation?: false | 'answer-only' | 'exam-with-answers'
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
const ANSWER_ONLY_DOUBLE_EXPLANATION_FRAGMENT_MAX_CHARS = 300
const EXAM_WITH_ANSWERS_DOUBLE_EXPLANATION_FRAGMENT_MAX_CHARS = 360
const DOUBLE_COLUMN_ANSWER_CONTINUATION_MIN_LENGTH = 420
const DOUBLE_COLUMN_BODY_FRAGMENT_MIN_LENGTH = 420
const DOUBLE_COLUMN_BODY_FRAGMENT_MAX_CHARS = 420
const EXAM_PAPER_DEBUG_STORAGE_KEY = 'exam-paper-pdf-debug'

function isExamPaperDebugEnabled() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const debugWindow = window as typeof window & {
      __EXAM_PAPER_PDF_DEBUG__?: boolean
    }

    return debugWindow.__EXAM_PAPER_PDF_DEBUG__ === true ||
      window.localStorage.getItem(EXAM_PAPER_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function logExamPaperDebug(event: string, payload: Record<string, unknown>) {
  if (!isExamPaperDebugEnabled()) {
    return
  }

  console.log(`[exam-paper:${event}]`, payload)
}

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

function buildFlowBodyText(question: TwoColumnLayoutQuestionLike) {
  return BODY_SECTION_DEFINITIONS
    .map(({ resolveText }) => normalizeSectionText(resolveText(question)))
    .filter(Boolean)
    .join('\n\n')
}

function getBodyFragmentBaseUnit(
  continuationPosition: TwoColumnContinuationPosition
): number {
  if (continuationPosition === 'single') {
    return 42
  }

  if (continuationPosition === 'start') {
    return 38
  }

  if (continuationPosition === 'middle') {
    return 12
  }

  return 18
}

function getTitleSuffix(viewMode: ExamPaperLayoutViewMode): string {
  if (viewMode === 'answer-only') {
    return ' - 답안'
  }

  if (viewMode === 'exam-only') {
    return ' - 시험지'
  }

  return ''
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
      charsPerLine: 31,
      lineUnit: 24,
      baseUnit: continuationPosition === 'single' || continuationPosition === 'start' ? 40 : 12,
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

    const fragment = {
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

    logExamPaperDebug('choice-fragment', {
      questionNumber: section.questionNumber,
      sourceSectionId: section.id,
      fragmentId: fragment.id,
      fragmentIndex: index,
      continuationPosition,
      estimatedUnits: fragment.estimatedUnits,
      choiceLabel: choiceRow.label,
      choiceTextLength: choiceRow.text.length,
    })

    return fragment
  })
}

function createBodyFragments(section: TwoColumnSectionPlan) {
  const sectionText = section.text ?? ''

  if (sectionText.length < DOUBLE_COLUMN_BODY_FRAGMENT_MIN_LENGTH) {
    return [createSingleFragmentFromSection(section)]
  }

  const chunks = splitTextIntoFlowChunks(sectionText, DOUBLE_COLUMN_BODY_FRAGMENT_MAX_CHARS)

  if (chunks.length <= 1) {
    return [createSingleFragmentFromSection(section)]
  }

  return chunks.map((chunkText, index) => {
    const continuationPosition = getContinuationPosition(index, chunks.length)
    const fragment = {
      id: buildFragmentId(section.id, index, chunks.length),
      sourceSectionId: section.id,
      questionNumber: section.questionNumber,
      kind: section.kind,
      sectionKey: section.sectionKey,
      continuationPosition,
      fragmentIndex: index,
      estimatedUnits: estimateSectionUnits(chunkText, {
        charsPerLine: 34,
        lineUnit: 24,
        baseUnit: getBodyFragmentBaseUnit(continuationPosition),
      }),
      splittable: true,
      payload: {
        type: 'body',
        text: chunkText,
      },
    } satisfies TwoColumnFragmentPlan

    logExamPaperDebug('body-fragment', {
      questionNumber: section.questionNumber,
      sourceSectionId: section.id,
      fragmentId: fragment.id,
      fragmentIndex: index,
      fragmentCount: chunks.length,
      continuationPosition,
      estimatedUnits: fragment.estimatedUnits,
      textLength: chunkText.length,
    })

    return fragment
  })
}

function createAnswerFragments(section: TwoColumnSectionPlan) {
  const explanationMaxChars = section.allowContinuation === 'answer-only'
    ? ANSWER_ONLY_DOUBLE_EXPLANATION_FRAGMENT_MAX_CHARS
    : EXAM_WITH_ANSWERS_DOUBLE_EXPLANATION_FRAGMENT_MAX_CHARS
  const explanationChunks = splitTextIntoFlowChunks(
    section.explanationText ?? '',
    explanationMaxChars
  )
  const chunks = explanationChunks.length > 0
    ? explanationChunks
    : [section.explanationText ?? '']
  const fragmentCount = chunks.length

  return chunks.map((explanationChunk, index) => {
    const continuationPosition = getContinuationPosition(index, fragmentCount)
    const isFirstFragment = index === 0

    const fragment = {
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

    logExamPaperDebug('answer-fragment', {
      questionNumber: section.questionNumber,
      sourceSectionId: section.id,
      fragmentId: fragment.id,
      fragmentIndex: index,
      fragmentCount,
      continuationPosition,
      estimatedUnits: fragment.estimatedUnits,
      answerTextLength: (isFirstFragment ? section.answerText : '')?.length ?? 0,
      explanationTextLength: explanationChunk.length,
      questionLabelLength: (isFirstFragment ? section.questionLabel : '')?.length ?? 0,
    })

    return fragment
  })
}

function buildSectionFragments(section: TwoColumnSectionPlan) {
  if (section.kind === 'body') {
    return createBodyFragments(section)
  }

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

function shouldAllowAnswerContinuation(
  options: ExamPaperRenderOptions,
  estimatedAnswerText: string
): TwoColumnSectionPlan['allowContinuation'] {
  if (!options.isDoubleColumn || !options.showAnswers) {
    return false
  }

  if (options.viewMode === 'answer-only') {
    return 'answer-only'
  }

  if (options.viewMode === 'exam-with-answers' && estimatedAnswerText.length >= DOUBLE_COLUMN_ANSWER_CONTINUATION_MIN_LENGTH) {
    return 'exam-with-answers'
  }

  return false
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
    titleSuffix: getTitleSuffix(viewMode),
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

    if (options.isDoubleColumn) {
      const flowBodyText = buildFlowBodyText(question)

      if (flowBodyText) {
        sections.push({
          id: `question-${question.number}-body`,
          questionNumber: question.number,
          kind: 'body',
          sectionKey: 'body',
          estimatedUnits: estimateSectionUnits(flowBodyText, {
            charsPerLine: 34,
            lineUnit: 24,
            baseUnit: 42,
          }),
          text: flowBodyText,
        })
      }
    } else {
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
            charsPerLine: 34,
            lineUnit: 24,
            baseUnit: 42,
          }),
          text: bodyText,
        })
      })
    }

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
        allowContinuation: shouldAllowAnswerContinuation(options, estimatedAnswerText),
      })
    }
  }

  if (isExamPaperDebugEnabled()) {
    sections.forEach((section) => {
      logExamPaperDebug('question-section', {
        questionNumber: question.number,
        viewMode: options.viewMode,
        columnLayout: options.columnLayout,
        id: section.id,
        kind: section.kind,
        sectionKey: section.sectionKey,
        estimatedUnits: section.estimatedUnits,
        textLength: section.text?.length ?? 0,
        answerTextLength: section.answerText?.length ?? 0,
        explanationTextLength: section.explanationText?.length ?? 0,
        choiceCount: section.choiceRows?.length ?? 0,
        allowContinuation: section.allowContinuation ?? false,
      })
    })
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
    rebalanceEmptyRightColumn: true,
  })

  logExamPaperDebug('layout-plan', {
    target,
    profile,
    hasDescription,
    includeAnswers,
    firstPageSlotCapacity,
    otherPageSlotCapacity,
    pages: layoutPlan.pages.map((page) => ({
      pageIndex: page.pageIndex,
      columns: page.columns.map((column) => ({
        columnIndex: column.columnIndex,
        sectionIds: column.sectionIds,
        estimatedUnits: column.sections.reduce((sum, section) => sum + section.estimatedHeight, 0),
      })),
    })),
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
  rebalanceEmptyRightColumn = false,
}: {
  questionPlans: ExamPaperQuestionPlan<TPayload>[]
  viewMode: ExamPaperLayoutViewMode
  columnLayout: ExamPaperLayoutColumnLayout
  firstPageSlotCapacity?: number
  otherPageSlotCapacity?: number
  slotCapacity?: number
  rebalanceEmptyRightColumn?: boolean
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
      rebalanceEmptyRightColumn,
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
