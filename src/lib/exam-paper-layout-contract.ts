import { paginateTwoColumnQuestionChunks } from '@/lib/exam-paper-pdf-pagination.js'
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

export interface ExamPaperLayoutPlan<TPayload> {
  viewMode: ExamPaperLayoutViewMode
  columnLayout: ExamPaperLayoutColumnLayout
  pages: ExamPaperPagePlan<TPayload>[]
  questions: ExamPaperQuestionPlan<TPayload>[]
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
}

export interface TwoColumnQuestionSectionPlan {
  questionNumber: number
  sections: TwoColumnSectionPlan[]
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
  stageLayouts: ExamPaperLayoutPlan<TwoColumnSectionPlan>[]
): ExamPaperPagePlan<TwoColumnSectionPlan>[] {
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
}: BuildTwoColumnLayoutPlanInput): ExamPaperLayoutPlan<TwoColumnSectionPlan> {
  const includeAnswers = questionPlans.some(hasAnswerSections)
  const resolvedProfile = resolveTwoColumnLayoutProfile(profile, target, hasDescription)
  const stageLayouts = buildTwoColumnLayoutStages(
    questionPlans,
    resolvedProfile,
    includeAnswers
  ).map((stage) => buildExamPaperLayoutPlan<TwoColumnSectionPlan>({
    questionPlans: stage.questionPlans.map(toLayoutQuestionPlan),
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
