import { z } from 'zod'
import type { WorkspaceSubject } from './workspace-subject'

export const LANDING_THEME_TOKENS = ['indigo', 'emerald', 'neutral'] as const
export type LandingThemeToken = (typeof LANDING_THEME_TOKENS)[number]

export const LANDING_ICON_TOKENS = [
  'sparkles',
  'bookOpen',
  'fileText',
  'languages',
  'libraryBig',
  'brainCircuit',
  'folderKanban',
  'packageSearch',
  'shoppingBag',
  'scrollText',
  'wandSparkles',
] as const
export type LandingIconToken = (typeof LANDING_ICON_TOKENS)[number]

const landingThemeTokenSchema = z.enum(LANDING_THEME_TOKENS)
const landingIconTokenSchema = z.enum(LANDING_ICON_TOKENS)

const limitedString = (max: number) => z.string().trim().min(1).max(max)

const workspaceCardSchema = z.object({
  subject: z.enum(['english', 'korean']),
  label: limitedString(30),
  title: limitedString(24),
  description: limitedString(90),
  buttonLabel: limitedString(24),
  highlightChips: z.array(limitedString(16)).min(1).max(3),
  accentTheme: landingThemeTokenSchema,
  icon: landingIconTokenSchema,
})

const valuePointSchema = z.object({
  title: limitedString(24),
  description: limitedString(90),
  icon: landingIconTokenSchema,
})

const workspaceFeatureSchema = z.object({
  title: limitedString(24),
  description: limitedString(90),
  icon: landingIconTokenSchema,
})

const workspaceStepSchema = z.object({
  title: limitedString(24),
  description: limitedString(90),
  icon: landingIconTokenSchema,
})

export const mainLandingConfigSchema = z.object({
  hero: z.object({
    badge: limitedString(30),
    title: limitedString(40),
    description: limitedString(120),
    chips: z.tuple([limitedString(18), limitedString(18), limitedString(18)]),
  }),
  workspaceCards: z.tuple([workspaceCardSchema, workspaceCardSchema]),
  valueSection: z.object({
    heading: limitedString(30),
    intro: limitedString(120),
  }),
  valuePoints: z.tuple([valuePointSchema, valuePointSchema, valuePointSchema]),
})

export const workspaceLandingConfigSchema = z.object({
  eyebrow: limitedString(30),
  title: limitedString(40),
  description: limitedString(120),
  heroSummary: limitedString(140),
  featureHeading: limitedString(30),
  featureIntro: limitedString(120),
  workflowBadge: limitedString(30),
  workflowHeading: limitedString(30),
  workflowIntro: limitedString(120),
  ctaHeadline: limitedString(36),
  ctaBody: limitedString(120),
  ctaHint: limitedString(90),
  quickPills: z.array(limitedString(16)).min(1).max(4),
  features: z.array(workspaceFeatureSchema).min(1).max(4),
  steps: z.array(workspaceStepSchema).min(1).max(4),
  theme: landingThemeTokenSchema,
})

export type MainLandingConfig = z.infer<typeof mainLandingConfigSchema>
export type WorkspaceLandingConfig = z.infer<typeof workspaceLandingConfigSchema>

const DEFAULT_MAIN_LANDING_CONFIG: MainLandingConfig = {
  hero: {
    badge: 'AI English & Korean Workspace',
    title: '써머썬 연구소',
    description: '영어와 국어 서비스 진입점을 한곳에 모았습니다. 어떤 수업을 준비하든, 필요한 워크스페이스를 고르고 바로 다음 작업으로 이어가세요.',
    chips: ['영어 문제생성부터 문제지 제작까지', '국어 문제마켓과 자료관리 흐름', '한 번의 선택으로 더 빠른 진입'],
  },
  workspaceCards: [
    {
      subject: 'english',
      label: 'English Workspace',
      title: '영어 들어가기',
      description: '문제생성, 문제은행, 라이브러리, 문제지 제작까지 영어 수업 운영의 핵심 흐름을 빠르게 연결합니다.',
      buttonLabel: '영어 서비스 열기',
      highlightChips: ['AI 문제생성', '문제은행', '문제지 제작'],
      accentTheme: 'indigo',
      icon: 'languages',
    },
    {
      subject: 'korean',
      label: 'Korean Workspace',
      title: '국어 들어가기',
      description: '문제마켓, 자료관리, 라이브러리를 한 워크스페이스에서 자연스럽게 이어갑니다.',
      buttonLabel: '국어 서비스 열기',
      highlightChips: ['문제마켓', '자료관리', '라이브러리'],
      accentTheme: 'emerald',
      icon: 'libraryBig',
    },
  ],
  valueSection: {
    heading: '왜 워크스페이스로 바로 들어가야 할까요?',
    intro: '필요한 기능을 먼저 보여주고, 다음 작업까지 자연스럽게 이어주는 진입 경험으로 정리했습니다.',
  },
  valuePoints: [
    {
      title: '더 빠른 시작',
      description: '과목별 워크스페이스를 바로 선택해 필요한 서비스만 빠르게 진입할 수 있습니다.',
      icon: 'sparkles',
    },
    {
      title: '흐름 중심 구성',
      description: '생성, 정리, 보관, 문제지 제작까지 실제 수업 운영 흐름을 따라 이동합니다.',
      icon: 'bookOpen',
    },
    {
      title: '한눈에 비교',
      description: '영어와 국어의 핵심 가치와 진입 포인트를 비교한 뒤 바로 선택할 수 있습니다.',
      icon: 'fileText',
    },
  ],
}

const DEFAULT_WORKSPACE_LANDING_CONFIG: Record<WorkspaceSubject, WorkspaceLandingConfig> = {
  english: {
    eyebrow: 'English Workspace',
    title: 'AI 영어 수업 운영을 더 빠르고 세련되게.',
    description: '문제생성부터 문제은행, 라이브러리, 문제지 제작까지 영어 서비스 전체를 한 흐름으로 이어보세요.',
    heroSummary: '개인지문 생성, 보드형 생성, 문항 축적, 문제지 제작까지 수업 준비에서 반복되는 핵심 작업을 더 짧은 시간 안에 정리할 수 있습니다.',
    featureHeading: '영어 서비스에서 바로 할 수 있는 일',
    featureIntro: '현재 메인페이지의 안내 흐름을 바탕으로, 영어 수업 운영에서 자주 쓰는 작업을 아이콘 중심으로 다시 정리했습니다.',
    workflowBadge: 'Workflow Overview',
    workflowHeading: '영어 서비스 활용 흐름',
    workflowIntro: '처음 들어온 사용자도 어떤 순서로 서비스를 활용하면 되는지 한눈에 이해할 수 있도록 단계형 흐름을 추가했습니다.',
    ctaHeadline: '영어 수업 준비를 하나의 워크스페이스로 정리하세요',
    ctaBody: '문제생성부터 문제지 정리까지 끊기지 않는 흐름으로 이어지도록, 영어 워크스페이스 진입점을 더 선명하게 구성했습니다.',
    ctaHint: '영어문제생성과 영어문제마켓의 첫 번째 메뉴로 바로 이동할 수 있습니다.',
    quickPills: ['개인지문 생성', '문제은행 정리', '라이브러리 연결', '문제지 제작'],
    features: [
      { icon: 'brainCircuit', title: 'AI 문제생성', description: '개인지문과 보드형 생성 흐름을 통해 영어 문항을 빠르게 만들고 다음 작업으로 바로 연결합니다.' },
      { icon: 'folderKanban', title: '문제은행 운영', description: '축적된 문항을 정리해 다음 수업, 다음 시험지, 다음 보강 자료로 자연스럽게 재사용합니다.' },
      { icon: 'libraryBig', title: '라이브러리 흐름', description: '지문, 구매 문제, 문제지까지 흩어지지 않도록 영어 워크스페이스 기준으로 정리합니다.' },
      { icon: 'fileText', title: '문제지 제작', description: '완성된 문항을 모아 실제 배포 가능한 문제지 결과물로 빠르게 정리합니다.' },
    ],
    steps: [
      { icon: 'bookOpen', title: '지문 준비', description: '수업 자료나 개인지문에서 출발해 작업 맥락을 잡습니다.' },
      { icon: 'sparkles', title: '문제 생성', description: 'AI가 필요한 문제 유형을 빠르게 생성합니다.' },
      { icon: 'folderKanban', title: '문항 정리', description: '생성된 문항을 은행과 라이브러리에 축적합니다.' },
      { icon: 'scrollText', title: '문제지 완성', description: '최종적으로 시험지/학습지 형태로 정리합니다.' },
    ],
    theme: 'indigo',
  },
  korean: {
    eyebrow: 'Korean Workspace',
    title: '국어문제마켓과 국어 라이브러리 흐름을 더 선명하게.',
    description: '현재 국어 워크스페이스에서는 국어문제마켓 탐색과 국어 라이브러리의 문제마켓 관리 흐름을 중심으로 이용할 수 있습니다.',
    heroSummary: '국어문제마켓에서 필요한 자료를 찾고, 라이브러리의 국어문제마켓 관리에서 다시 확인하는 핵심 흐름만 더 보기 쉽게 정리했습니다.',
    featureHeading: '국어 서비스에서 바로 할 수 있는 일',
    featureIntro: '현재 제공 중인 국어 기능만 기준으로, 문제마켓 탐색과 라이브러리 관리 흐름을 국어 워크스페이스 관점에서 다시 정리했습니다.',
    workflowBadge: 'Workflow Overview',
    workflowHeading: '국어 서비스 활용 흐름',
    workflowIntro: '처음 들어온 사용자도 어떤 순서로 서비스를 활용하면 되는지 한눈에 이해할 수 있도록 단계형 흐름을 추가했습니다.',
    ctaHeadline: '국어문제마켓과 라이브러리 흐름만 바로 이어보세요',
    ctaBody: '지금 제공 중인 국어 서비스는 문제마켓 탐색과 라이브러리의 국어문제마켓 관리 흐름에 집중되어 있습니다.',
    ctaHint: '국어문제마켓 드롭다운의 첫 번째 메뉴로 바로 이동할 수 있습니다.',
    quickPills: ['문제마켓 탐색', '상품 확인', '국어문제마켓 관리'],
    features: [
      { icon: 'shoppingBag', title: '문제마켓 탐색', description: '주제와 용도에 맞는 국어 콘텐츠를 빠르게 찾고 필요한 흐름으로 이어갈 수 있습니다.' },
      { icon: 'packageSearch', title: '상품 확인', description: '문제마켓 안에서 필요한 자료를 살펴보고 현재 제공 중인 국어 콘텐츠를 빠르게 비교할 수 있습니다.' },
      { icon: 'libraryBig', title: '국어문제마켓 관리', description: '라이브러리 안에서 구매한 국어문제마켓 자료를 다시 확인하고 관리 흐름으로 이어갈 수 있습니다.' },
    ],
    steps: [
      { icon: 'shoppingBag', title: '문제마켓 탐색', description: '국어문제마켓에서 필요한 자료를 먼저 둘러봅니다.' },
      { icon: 'packageSearch', title: '상품 확인', description: '관심 있는 자료를 확인하고 필요한 항목을 선택합니다.' },
      { icon: 'libraryBig', title: '국어문제마켓 관리', description: '라이브러리에서 구매한 국어문제마켓 자료를 다시 관리합니다.' },
    ],
    theme: 'emerald',
  },
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function getDefaultMainLandingConfig() {
  return clone(DEFAULT_MAIN_LANDING_CONFIG)
}

export function getDefaultWorkspaceLandingConfig(subject: WorkspaceSubject) {
  return clone(DEFAULT_WORKSPACE_LANDING_CONFIG[subject])
}

export function normalizeMainLandingConfig(raw: unknown): MainLandingConfig {
  const parsed = mainLandingConfigSchema.safeParse(raw)
  return parsed.success ? parsed.data : getDefaultMainLandingConfig()
}

export function normalizeWorkspaceLandingConfig(subject: WorkspaceSubject, raw: unknown): WorkspaceLandingConfig {
  const parsed = workspaceLandingConfigSchema.safeParse(raw)
  return parsed.success ? parsed.data : getDefaultWorkspaceLandingConfig(subject)
}

export function validateMainLandingConfig(raw: unknown): MainLandingConfig {
  return mainLandingConfigSchema.parse(raw)
}

export function validateWorkspaceLandingConfig(raw: unknown): WorkspaceLandingConfig {
  return workspaceLandingConfigSchema.parse(raw)
}
