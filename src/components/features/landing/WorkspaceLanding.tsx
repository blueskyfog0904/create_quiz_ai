import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { workspaceHref } from '@/lib/workspace-routes'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface WorkspaceLandingProps {
  subject: WorkspaceSubject
  isLoggedIn: boolean
}

interface WorkspaceFeature {
  title: string
  description: string
}

interface WorkspaceLandingContent {
  eyebrow: string
  title: string
  description: string
  primaryLabel: string
  secondaryLabel: string
  heroSummary: string
  features: WorkspaceFeature[]
}

const landingContent: Record<WorkspaceSubject, WorkspaceLandingContent> = {
  english: {
    eyebrow: 'English Workspace',
    title: '영어 워크스페이스',
    description: '문제생성부터 문제은행, 문제지 제작까지 영어 서비스 전체를 이용하세요.',
    primaryLabel: '영어 서비스 들어가기',
    secondaryLabel: '영어문제 관리 보기',
    heroSummary: '문제생성, 문제은행, 라이브러리, 문제지 제작까지 영어 학습 운영에 필요한 흐름을 한 곳에서 이어갑니다.',
    features: [
      {
        title: 'AI 문제생성',
        description: '개인지문과 보드형 생성 흐름을 통해 다양한 영어 문제를 빠르게 만듭니다.',
      },
      {
        title: '문제은행 정리',
        description: '저장된 문항을 과목 흐름에 맞춰 누적하고 다시 꺼내 사용할 수 있습니다.',
      },
      {
        title: '라이브러리 관리',
        description: '지문, 구매 문제, 문제지를 연결된 구조로 정리해 다음 작업으로 이어갑니다.',
      },
      {
        title: '문제지 제작',
        description: '완성된 문항을 모아 문제지로 편집하고 배포 가능한 결과물로 정리합니다.',
      },
    ],
  },
  korean: {
    eyebrow: 'Korean Workspace',
    title: '국어 워크스페이스',
    description: '국어 자료 관리와 문제마켓을 중심으로 국어 서비스를 이용하세요.',
    primaryLabel: '국어 서비스 들어가기',
    secondaryLabel: '국어문제 관리 보기',
    heroSummary: '문제마켓 탐색, 자료 관리, 라이브러리 정리, 문제지 흐름까지 국어 운영에 필요한 핵심 작업을 한 화면에서 연결합니다.',
    features: [
      {
        title: '문제마켓 탐색',
        description: '국어 자료와 상품을 주제별로 살펴보고 필요한 콘텐츠를 빠르게 찾습니다.',
      },
      {
        title: '자료 관리',
        description: '과목 운영에 필요한 자료와 문제를 국어 워크스페이스 기준으로 정리합니다.',
      },
      {
        title: '라이브러리 흐름',
        description: '구매한 문제와 문제지를 라이브러리에 모아 다음 작업으로 이어갑니다.',
      },
      {
        title: '문제지 연결',
        description: '필요한 자료를 선별한 뒤 문제지 작업으로 자연스럽게 연결할 수 있습니다.',
      },
    ],
  },
}

export function WorkspaceLanding({ subject, isLoggedIn }: WorkspaceLandingProps) {
  const content = landingContent[subject]
  const primaryHref = subject === 'english'
    ? workspaceHref(subject, 'generate')
    : workspaceHref(subject, 'market')
  const secondaryHref = workspaceHref(subject, 'libraryPurchased')
  const entryHref = isLoggedIn ? primaryHref : `/login?next=${encodeURIComponent(primaryHref)}`

  return (
    <div className="bg-gray-50">
      <section className="container mx-auto px-4 py-16 md:py-20">
        <div className="rounded-[2rem] bg-white px-6 py-10 shadow-sm ring-1 ring-gray-100 md:px-10 md:py-14">
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.25em] text-primary">
              {content.eyebrow}
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-gray-900 md:text-6xl word-keep-all">
              {content.title}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600 md:text-xl word-keep-all">
              {content.description}
            </p>
            <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-gray-500 word-keep-all">
              {content.heroSummary}
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link href={entryHref}>
                <Button size="lg" className="px-8 text-lg">
                  {content.primaryLabel}
                </Button>
              </Link>
              <Link href={secondaryHref}>
                <Button variant="outline" size="lg" className="text-lg">
                  {content.secondaryLabel}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 md:text-3xl word-keep-all">
            {subject === 'english' ? '영어 서비스에서 바로 할 수 있는 일' : '국어 서비스에서 바로 할 수 있는 일'}
          </h2>
          <p className="mt-3 text-base text-gray-600 word-keep-all">
            기존 메인페이지에서 안내하던 핵심 흐름을 subject 랜딩에 맞게 정리했습니다.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {content.features.map((feature) => (
            <div key={feature.title} className="rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
              <h3 className="text-2xl font-semibold text-gray-900 word-keep-all">
                {feature.title}
              </h3>
              <p className="mt-3 text-base leading-7 text-gray-600 word-keep-all">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
