import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  BrainCircuit,
  FileText,
  FolderKanban,
  LibraryBig,
  PackageSearch,
  ScrollText,
  ShoppingBag,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { getActiveHeaderNavigationItems } from '@/lib/header-navigation'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import { resolveWorkspaceLandingQuickEntryTargets } from '@/lib/workspace-landing-quick-entry'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface WorkspaceLandingProps {
  subject: WorkspaceSubject
  isLoggedIn: boolean
}

interface WorkspaceFeature {
  icon: LucideIcon
  title: string
  description: string
}

interface WorkspaceStep {
  icon: LucideIcon
  title: string
  description: string
}

interface WorkspaceLandingTheme {
  heroGradient: string
  heroGlow: string
  badgeClass: string
  cardAccentClass: string
  ctaButtonClass: string
  sectionTintClass: string
}

interface WorkspaceLandingContent {
  eyebrow: string
  title: string
  description: string
  heroSummary: string
  featureHeading: string
  featureIntro: string
  primaryLabel: string
  secondaryLabel: string
  ctaHeadline: string
  ctaBody: string
  ctaHint: string
  quickPills: string[]
  features: WorkspaceFeature[]
  steps: WorkspaceStep[]
  theme: WorkspaceLandingTheme
}

const landingContent: Record<WorkspaceSubject, WorkspaceLandingContent> = {
  english: {
    eyebrow: 'English Workspace',
    title: 'AI 영어 수업 운영을 더 빠르고 세련되게.',
    description: '문제생성부터 문제은행, 라이브러리, 문제지 제작까지 영어 서비스 전체를 한 흐름으로 이어보세요.',
    heroSummary: '개인지문 생성, 보드형 생성, 문항 축적, 문제지 제작까지 수업 준비에서 반복되는 핵심 작업을 더 짧은 시간 안에 정리할 수 있습니다.',
    featureHeading: '영어 서비스에서 바로 할 수 있는 일',
    featureIntro: '현재 메인페이지의 안내 흐름을 바탕으로, 영어 수업 운영에서 자주 쓰는 작업을 아이콘 중심으로 다시 정리했습니다.',
    primaryLabel: '영어문제생성 서비스 들어가기',
    secondaryLabel: '영어문제마켓 서비스 들어가기',
    ctaHeadline: '영어 수업 준비를 하나의 워크스페이스로 정리하세요',
    ctaBody: '문제생성부터 문제지 정리까지 끊기지 않는 흐름으로 이어지도록, 영어 워크스페이스 진입점을 더 선명하게 구성했습니다.',
    ctaHint: '영어문제생성과 영어문제마켓의 첫 번째 메뉴로 바로 이동할 수 있습니다.',
    quickPills: ['개인지문 생성', '문제은행 정리', '라이브러리 연결', '문제지 제작'],
    features: [
      {
        icon: BrainCircuit,
        title: 'AI 문제생성',
        description: '개인지문과 보드형 생성 흐름을 통해 영어 문항을 빠르게 만들고 다음 작업으로 바로 연결합니다.',
      },
      {
        icon: FolderKanban,
        title: '문제은행 운영',
        description: '축적된 문항을 정리해 다음 수업, 다음 시험지, 다음 보강 자료로 자연스럽게 재사용합니다.',
      },
      {
        icon: LibraryBig,
        title: '라이브러리 흐름',
        description: '지문, 구매 문제, 문제지까지 흩어지지 않도록 영어 워크스페이스 기준으로 정리합니다.',
      },
      {
        icon: FileText,
        title: '문제지 제작',
        description: '완성된 문항을 모아 실제 배포 가능한 문제지 결과물로 빠르게 정리합니다.',
      },
    ],
    steps: [
      {
        icon: BookOpen,
        title: '지문 준비',
        description: '수업 자료나 개인지문에서 출발해 작업 맥락을 잡습니다.',
      },
      {
        icon: Sparkles,
        title: '문제 생성',
        description: 'AI가 필요한 문제 유형을 빠르게 생성합니다.',
      },
      {
        icon: FolderKanban,
        title: '문항 정리',
        description: '생성된 문항을 은행과 라이브러리에 축적합니다.',
      },
      {
        icon: ScrollText,
        title: '문제지 완성',
        description: '최종적으로 시험지/학습지 형태로 정리합니다.',
      },
    ],
    theme: {
      heroGradient: 'from-indigo-600 via-blue-600 to-sky-500',
      heroGlow: 'bg-indigo-500/30',
      badgeClass: 'border-white/20 bg-white/10 text-white',
      cardAccentClass: 'from-indigo-500/10 via-blue-400/5 to-sky-400/10',
      ctaButtonClass: 'bg-white text-slate-900 hover:bg-slate-100',
      sectionTintClass: 'from-indigo-500/5 via-transparent to-sky-500/5',
    },
  },
  korean: {
    eyebrow: 'Korean Workspace',
    title: '국어 자료 운영과 문제마켓 흐름을 더 선명하게.',
    description: '국어 자료 관리와 문제마켓, 라이브러리, 문제지 연결까지 필요한 작업을 하나의 워크스페이스에서 이어보세요.',
    heroSummary: '문제마켓 탐색, 자료 정리, 라이브러리 축적, 문제지 연결처럼 국어 운영에서 자주 반복되는 흐름을 더 보기 쉽게 재구성했습니다.',
    featureHeading: '국어 서비스에서 바로 할 수 있는 일',
    featureIntro: '기존 메인페이지에서 안내하던 핵심 흐름을 국어 워크스페이스 관점으로 재배열해, 어디서 무엇을 해야 하는지 더 분명하게 보이도록 만들었습니다.',
    primaryLabel: '국어문제마켓 서비스 들어가기',
    secondaryLabel: '',
    ctaHeadline: '국어 운영 흐름도 워크스페이스 중심으로 더 간결하게',
    ctaBody: '문제마켓 탐색부터 자료관리, 라이브러리 정리, 문제지 연결까지 국어 서비스에서 자주 오가는 흐름을 한 화면 안에서 이해할 수 있도록 구성했습니다.',
    ctaHint: '국어문제마켓 드롭다운의 첫 번째 메뉴로 바로 이동할 수 있습니다.',
    quickPills: ['문제마켓 탐색', '자료관리', '라이브러리 축적', '문제지 연결'],
    features: [
      {
        icon: ShoppingBag,
        title: '문제마켓 탐색',
        description: '주제와 용도에 맞는 국어 콘텐츠를 빠르게 찾고 필요한 흐름으로 이어갈 수 있습니다.',
      },
      {
        icon: PackageSearch,
        title: '자료 관리',
        description: '과목 운영에 필요한 자료와 문제를 국어 워크스페이스 기준으로 정리하고 다시 꺼냅니다.',
      },
      {
        icon: LibraryBig,
        title: '라이브러리 연결',
        description: '구매 자료와 문제를 라이브러리에 축적해 다음 작업의 출발점으로 사용합니다.',
      },
      {
        icon: FileText,
        title: '문제지 흐름',
        description: '정리된 자료를 바탕으로 문제지 작업까지 자연스럽게 연결합니다.',
      },
    ],
    steps: [
      {
        icon: ShoppingBag,
        title: '자료 탐색',
        description: '문제마켓과 자료 출발점을 먼저 정리합니다.',
      },
      {
        icon: PackageSearch,
        title: '자료 정리',
        description: '필요한 자료와 문제를 국어 기준으로 묶습니다.',
      },
      {
        icon: LibraryBig,
        title: '라이브러리 축적',
        description: '반복해서 쓰는 자료를 누적하고 관리합니다.',
      },
      {
        icon: ScrollText,
        title: '문제지 연결',
        description: '최종 결과물을 실제 수업 준비 흐름으로 잇습니다.',
      },
    ],
    theme: {
      heroGradient: 'from-emerald-600 via-teal-600 to-cyan-500',
      heroGlow: 'bg-emerald-500/30',
      badgeClass: 'border-white/20 bg-white/10 text-white',
      cardAccentClass: 'from-emerald-500/10 via-teal-400/5 to-cyan-400/10',
      ctaButtonClass: 'bg-white text-slate-900 hover:bg-slate-100',
      sectionTintClass: 'from-emerald-500/5 via-transparent to-cyan-500/5',
    },
  },
}

export async function WorkspaceLanding({ subject, isLoggedIn }: WorkspaceLandingProps) {
  const content = landingContent[subject]
  const navigationConfig = await getHeaderNavigationConfig(subject)
  const activeNavigationItems = getActiveHeaderNavigationItems(navigationConfig.items)
  const quickEntry = resolveWorkspaceLandingQuickEntryTargets(subject, activeNavigationItems)
  const primaryHref = isLoggedIn ? quickEntry.primaryHref : `/login?next=${encodeURIComponent(quickEntry.primaryHref)}`
  const secondaryHref = quickEntry.secondaryHref
    ? (isLoggedIn ? quickEntry.secondaryHref : `/login?next=${encodeURIComponent(quickEntry.secondaryHref)}`)
    : null

  return (
    <div className="relative overflow-hidden bg-slate-50 text-slate-900">
      <div className={`absolute left-1/2 top-0 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl ${content.theme.heroGlow}`} />
      <div className={`absolute inset-x-0 top-0 h-[34rem] bg-gradient-to-b ${content.theme.sectionTintClass}`} />

      <section className="relative container mx-auto px-4 py-16 md:py-20">
        <div className={`overflow-hidden rounded-[2rem] bg-gradient-to-br ${content.theme.heroGradient} px-6 py-10 text-white shadow-2xl shadow-slate-900/10 md:px-10 md:py-14`}>
          <div className="mx-auto max-w-5xl">
            <Badge className={`${content.theme.badgeClass} px-4 py-1 text-sm backdrop-blur-sm`}>
              <WandSparkles className="h-3.5 w-3.5" />
              {content.eyebrow}
            </Badge>

            <div className="mt-6 grid gap-10 lg:grid-cols-[1.4fr_0.9fr] lg:items-end">
              <div>
                <h1 className="text-4xl font-bold tracking-tight md:text-6xl word-keep-all">
                  {content.title}
                </h1>
                <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/90 md:text-xl word-keep-all">
                  {content.description}
                </p>
                <p className="mt-4 max-w-3xl text-base leading-7 text-white/75 word-keep-all">
                  {content.heroSummary}
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  {content.quickPills.map((pill) => (
                    <span key={pill} className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur-sm">
                      {pill}
                    </span>
                  ))}
                </div>
              </div>

              <Card className="border-white/15 bg-white/10 py-0 text-white shadow-lg backdrop-blur-md">
                <CardContent className="p-6">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
                    Quick Entry
                  </p>
                  <h2 className="mt-3 text-2xl font-bold word-keep-all">
                    지금 바로 {subject === 'english' ? '영어' : '국어'} 워크스페이스로 이동하세요
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/75 word-keep-all">
                    {content.ctaHint}
                  </p>
                  <Separator className="my-5 bg-white/15" />
                  <div className="flex flex-col gap-3">
                    <Link href={primaryHref}>
                      <Button size="lg" className={`w-full justify-between ${content.theme.ctaButtonClass}`}>
                        {quickEntry.primaryLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    {secondaryHref && quickEntry.secondaryLabel ? (
                      <Link href={secondaryHref}>
                        <Button size="lg" variant="outline" className="w-full justify-between border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                          {quickEntry.secondaryLabel}
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <section className="relative container mx-auto px-4 pb-8">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900 md:text-3xl word-keep-all">
            {content.featureHeading}
          </h2>
          <p className="mx-auto mt-3 max-w-3xl text-base leading-7 text-slate-600 word-keep-all">
            {content.featureIntro}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {content.features.map((feature) => {
            const Icon = feature.icon

            return (
              <Card key={feature.title} className="relative overflow-hidden border-slate-200 bg-white py-0 shadow-md shadow-slate-200/60">
                <div className={`absolute inset-0 bg-gradient-to-br ${content.theme.cardAccentClass}`} />
                <CardContent className="relative p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold text-slate-900 word-keep-all">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 word-keep-all">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="container mx-auto px-4 py-14">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <div className="mb-8 text-center">
            <Badge variant="outline" className="border-slate-300 bg-slate-50 px-4 py-1 text-slate-700">
              <Sparkles className="h-3.5 w-3.5" />
              Workflow Overview
            </Badge>
            <h2 className="mt-5 text-2xl font-bold text-slate-900 md:text-3xl word-keep-all">
              {subject === 'english' ? '영어 서비스 활용 흐름' : '국어 서비스 활용 흐름'}
            </h2>
            <p className="mx-auto mt-3 max-w-3xl text-base leading-7 text-slate-600 word-keep-all">
              처음 들어온 사용자도 어떤 순서로 서비스를 활용하면 되는지 한눈에 이해할 수 있도록 단계형 흐름을 추가했습니다.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-4">
            {content.steps.map((step, index) => {
              const Icon = step.icon

              return (
                <div key={step.title} className="relative rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm ring-1 ring-slate-200">
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className="text-sm font-semibold text-slate-400">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-5 text-xl font-semibold text-slate-900 word-keep-all">
                    {step.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600 word-keep-all">
                    {step.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20">
        <div className={`overflow-hidden rounded-[2rem] bg-gradient-to-r ${content.theme.heroGradient} p-8 text-white shadow-2xl shadow-slate-900/10 md:p-10`}>
          <div className="grid gap-8 lg:grid-cols-[1.3fr_0.9fr] lg:items-center">
            <div>
              <Badge className="border-white/20 bg-white/10 text-white">
                <Sparkles className="h-3.5 w-3.5" />
                Recommended Next Step
              </Badge>
              <h2 className="mt-5 text-3xl font-bold md:text-4xl word-keep-all">
                {content.ctaHeadline}
              </h2>
              <p className="mt-4 text-base leading-7 text-white/85 word-keep-all">
                {content.ctaBody}
              </p>
              <p className="mt-3 text-sm leading-6 text-white/70 word-keep-all">
                {content.ctaHint}
              </p>
            </div>

            <div className="rounded-[1.75rem] border border-white/20 bg-white/10 p-5 backdrop-blur-sm">
              <div className="space-y-3 text-sm text-white/80">
                <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3">
                  <Sparkles className="h-4 w-4" />
                  {quickEntry.primaryLabel}
                </div>
                {quickEntry.secondaryLabel ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3">
                    <LibraryBig className="h-4 w-4" />
                    {quickEntry.secondaryLabel}
                  </div>
                ) : null}
              </div>
              <div className="mt-5 flex flex-col gap-3">
                <Link href={primaryHref}>
                  <Button size="lg" className={`w-full justify-between ${content.theme.ctaButtonClass}`}>
                    {quickEntry.primaryLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                {secondaryHref && quickEntry.secondaryLabel ? (
                  <Link href={secondaryHref}>
                    <Button size="lg" variant="outline" className="w-full justify-between border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                      {quickEntry.secondaryLabel}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
