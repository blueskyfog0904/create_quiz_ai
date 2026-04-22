import {
  paginateTwoColumnQuestionChunks,
  splitTextIntoFlowChunks,
} from '@/lib/exam-paper-pdf-pagination.js'
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

interface TwoColumnLayoutStage {
  questionPlans: TwoColumnQuestionSectionPlan[]
  firstPageSlotCapacity: number
  otherPageSlotCapacity: number
}

const DEFAULT_COMPAT_LAYOUT_PROFILE_NAME: TwoColumnLayoutProfileName = 'shared-default'
const DEFAULT_COMPAT_LAYOUT_TARGET: TwoColumnLayoutTarget = 'preview'

// Task 3 shared-plan policy: keep the first answered question alone, let the next
// two questions share a page group, and split the penultimate answer block so the
// last answered question can start on its own closing page group.
const ANSWERED_STAGE_POLICY = {
  groupedStagingThreshold: 6,
  leadingSingleQuestionCount: 1,
  groupedSecondStageCount: 2,
} as const

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

function estimateBodyFragmentUnits(
  text: string,
  continuationPosition: TwoColumnContinuationPosition
) {
  return estimateSectionUnits(text, {
    charsPerLine: 38,
    lineUnit: 23,
    baseUnit: continuationPosition === 'single'
      ? 42
      : continuationPosition === 'start'
        ? 30
        : continuationPosition === 'middle'
          ? 16
          : 20,
  })
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
    answerText,
    explanationText,
    showAnswerLabel,
  }: {
    answerText?: string
    explanationText?: string
    showAnswerLabel: boolean
  },
  continuationPosition: TwoColumnContinuationPosition
) {
  const combinedText = [showAnswerLabel ? answerText ?? '' : '', explanationText ?? '']
    .filter(Boolean)
    .join('\n')

  return estimateSectionUnits(combinedText, {
    charsPerLine: 40,
    lineUnit: 22,
    baseUnit: continuationPosition === 'single'
      ? 156
      : showAnswerLabel
        ? 64
        : continuationPosition === 'middle'
          ? 14
          : 20,
  })
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
      answerText: section.answerText,
      explanationText: section.explanationText,
      explanationChunkIndex: section.explanationText ? 1 : undefined,
      explanationChunkCount: section.explanationText ? 1 : undefined,
      showAnswerLabel: true,
    },
  }
}

function createBodyFragments(section: TwoColumnSectionPlan) {
  const bodyChunks = splitTextIntoFlowChunks(section.text)

  if (bodyChunks.length <= 1) {
    return [createSingleFragmentFromSection(section)]
  }

  return bodyChunks.map((chunkText, index) => {
    const continuationPosition = getContinuationPosition(index, bodyChunks.length)

    return {
      id: buildFragmentId(section.id, index, bodyChunks.length),
      sourceSectionId: section.id,
      questionNumber: section.questionNumber,
      kind: section.kind,
      sectionKey: section.sectionKey,
      continuationPosition,
      fragmentIndex: index,
      estimatedUnits: estimateBodyFragmentUnits(chunkText, continuationPosition),
      splittable: true,
      payload: {
        type: 'body',
        text: chunkText,
      },
    } satisfies TwoColumnFragmentPlan
  })
}

function createChoiceFragments(section: TwoColumnSectionPlan) {
  const choiceRows = section.choiceRows ?? []

  if (choiceRows.length <= 1 || section.estimatedUnits <= 260) {
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
  if (
    section.estimatedUnits <= 260 ||
    !section.explanationText ||
    !section.answerText
  ) {
    return [createSingleFragmentFromSection(section)]
  }

  const explanationChunks = splitTextIntoFlowChunks(section.explanationText, 220)
  const fragmentInputs = explanationChunks.map((chunkText, index) => ({
    answerText: index === 0 ? section.answerText : undefined,
    explanationText: chunkText,
    showAnswerLabel: index === 0,
  }))

  return fragmentInputs.map((fragmentInput, index) => {
    const continuationPosition = getContinuationPosition(index, fragmentInputs.length)

    return {
      id: buildFragmentId(section.id, index, fragmentInputs.length),
      sourceSectionId: section.id,
      questionNumber: section.questionNumber,
      kind: section.kind,
      sectionKey: index === 0 ? 'answer' : 'explanation',
      continuationPosition,
      fragmentIndex: index,
      estimatedUnits: estimateAnswerFragmentUnits(fragmentInput, continuationPosition),
      splittable: true,
      payload: {
        type: 'answer',
        answerText: fragmentInput.answerText,
        explanationText: fragmentInput.explanationText,
        explanationChunkIndex: index + 1,
        explanationChunkCount: fragmentInputs.length,
        showAnswerLabel: fragmentInput.showAnswerLabel,
      },
    } satisfies TwoColumnFragmentPlan
  })
}

function buildSectionFragments(section: TwoColumnSectionPlan) {
  if (section.kind === 'body') {
    return createBodyFragments(section)
  }

  if (section.kind === 'choice') {
    return createChoiceFragments(section)
  }

  if (section.kind === 'answer') {
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

function chunkArray<TValue>(items: TValue[], size: number) {
  const chunks: TValue[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
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

function filterQuestionPlanSections(
  questionPlan: TwoColumnQuestionSectionPlan,
  predicate: (section: TwoColumnSectionPlan) => boolean
): TwoColumnQuestionSectionPlan {
  return {
    questionNumber: questionPlan.questionNumber,
    sections: questionPlan.sections.filter(predicate),
  }
}

function removeAnswerSections(questionPlan: TwoColumnQuestionSectionPlan) {
  return filterQuestionPlanSections(questionPlan, (section) => section.kind !== 'answer')
}

function keepOnlyAnswerSections(questionPlan: TwoColumnQuestionSectionPlan) {
  return filterQuestionPlanSections(questionPlan, (section) => section.kind === 'answer')
}

function buildExamOnlyStages(
  questionPlans: TwoColumnQuestionSectionPlan[],
  resolvedProfile: ResolvedTwoColumnLayoutProfile
): TwoColumnLayoutStage[] {
  if (questionPlans.length === 0) {
    return []
  }

  const [firstQuestionPlan, ...remainingQuestionPlans] = questionPlans

  return [
    {
      questionPlans: [firstQuestionPlan],
      firstPageSlotCapacity: resolvedProfile.promptSpreadSlotCapacity,
      otherPageSlotCapacity: resolvedProfile.promptSpreadSlotCapacity,
    },
    ...chunkArray(remainingQuestionPlans, 2).map((questionPlanGroup) => ({
      questionPlans: questionPlanGroup,
      firstPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
      otherPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
    })),
  ]
}

function buildAnsweredStages(
  questionPlans: TwoColumnQuestionSectionPlan[],
  resolvedProfile: ResolvedTwoColumnLayoutProfile
): TwoColumnLayoutStage[] {
  if (questionPlans.length === 0) {
    return []
  }

  if (questionPlans.length < ANSWERED_STAGE_POLICY.groupedStagingThreshold) {
    return questionPlans.map((questionPlan, index) => ({
      questionPlans: [questionPlan],
      firstPageSlotCapacity: index === 0
        ? resolvedProfile.promptSpreadSlotCapacity
        : resolvedProfile.otherPageSlotCapacity,
      otherPageSlotCapacity: index === 0
        ? resolvedProfile.promptSpreadSlotCapacity
        : resolvedProfile.otherPageSlotCapacity,
    }))
  }

  const stages: TwoColumnLayoutStage[] = [
    {
      questionPlans: questionPlans.slice(0, ANSWERED_STAGE_POLICY.leadingSingleQuestionCount),
      firstPageSlotCapacity: resolvedProfile.promptSpreadSlotCapacity,
      otherPageSlotCapacity: resolvedProfile.promptSpreadSlotCapacity,
    },
  ]

  const secondStageStartIndex = ANSWERED_STAGE_POLICY.leadingSingleQuestionCount
  const secondStageEndIndex = secondStageStartIndex + ANSWERED_STAGE_POLICY.groupedSecondStageCount
  const secondStageQuestionPlans = questionPlans.slice(secondStageStartIndex, secondStageEndIndex)
  if (secondStageQuestionPlans.length > 0) {
    stages.push({
      questionPlans: secondStageQuestionPlans,
      firstPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
      otherPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
    })
  }

  const trailingQuestionPlans = questionPlans.slice(secondStageEndIndex)
  if (trailingQuestionPlans.length === 0) {
    return stages
  }

  const lastQuestionPlan = trailingQuestionPlans[trailingQuestionPlans.length - 1]
  const penultimateQuestionPlan = trailingQuestionPlans.length > 1
    ? trailingQuestionPlans[trailingQuestionPlans.length - 2]
    : null
  const middleQuestionPlans = penultimateQuestionPlan === null
    ? []
    : trailingQuestionPlans.slice(0, -2)

  middleQuestionPlans.forEach((questionPlan) => {
    stages.push({
      questionPlans: [questionPlan],
      firstPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
      otherPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
    })
  })

  if (penultimateQuestionPlan) {
    const promptOnlyPlan = removeAnswerSections(penultimateQuestionPlan)
    if (promptOnlyPlan.sections.length > 0) {
      stages.push({
        questionPlans: [promptOnlyPlan],
        firstPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
        otherPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
      })
    }

    const answerOnlyPlan = keepOnlyAnswerSections(penultimateQuestionPlan)
    if (answerOnlyPlan.sections.length > 0) {
      stages.push({
        questionPlans: [answerOnlyPlan],
        firstPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
        otherPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
      })
    }
  }

  stages.push({
    questionPlans: [lastQuestionPlan],
    firstPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
    otherPageSlotCapacity: resolvedProfile.otherPageSlotCapacity,
  })

  return stages
}

function buildTwoColumnLayoutStages(
  questionPlans: TwoColumnQuestionSectionPlan[],
  resolvedProfile: ResolvedTwoColumnLayoutProfile,
  includeAnswers: boolean
) {
  return includeAnswers
    ? buildAnsweredStages(questionPlans, resolvedProfile)
    : buildExamOnlyStages(questionPlans, resolvedProfile)
}

function mergeStageLayouts(
  stageLayouts: ExamPaperLayoutPlan<TwoColumnFragmentPlan, TwoColumnSectionPlan>[]
): ExamPaperPagePlan<TwoColumnFragmentPlan>[] {
  return stageLayouts
    .flatMap((stageLayout) => stageLayout.pages)
    .map((page, pageIndex) => ({
      ...page,
      pageIndex,
      pageId: `page-${pageIndex + 1}`,
    }))
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
    const combinedAnswerText = [answerText, explanationText].filter(Boolean).join('\n')

    if (combinedAnswerText) {
      sections.push({
        id: `question-${question.number}-answer`,
        questionNumber: question.number,
        kind: 'answer',
        sectionKey: 'answer',
        estimatedUnits: estimateSectionUnits(combinedAnswerText, {
          charsPerLine: 40,
          lineUnit: 22,
          baseUnit: 156,
        }),
        text: combinedAnswerText,
        answerText,
        explanationText,
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
  const stageLayouts = buildTwoColumnLayoutStages(
    questionPlans,
    resolvedProfile,
    includeAnswers
  ).map((stage) => buildExamPaperLayoutPlan<TwoColumnFragmentPlan>({
    questionPlans: stage.questionPlans.map(toFragmentQuestionPlan),
    viewMode: includeAnswers ? 'exam-with-answers' : 'exam-only',
    columnLayout: 'double',
    firstPageSlotCapacity: stage.firstPageSlotCapacity,
    otherPageSlotCapacity: stage.otherPageSlotCapacity,
  }))

  return {
    viewMode: includeAnswers ? 'exam-with-answers' : 'exam-only',
    columnLayout: 'double',
    questions: questionPlans.map(toLayoutQuestionPlan),
    pages: mergeStageLayouts(stageLayouts),
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
