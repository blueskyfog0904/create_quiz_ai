import Link from 'next/link'
import { ArrowRight, BookOpen, FileText, Languages, LibraryBig, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface WorkspaceCard {
  subject: 'english' | 'korean'
  label: string
  title: string
  description: string
  buttonLabel: string
  buttonVariant: 'default' | 'outline'
  icon: LucideIcon
  highlights: string[]
  accentClass: string
}

const workspaceCards: WorkspaceCard[] = [
  {
    subject: 'english',
    label: 'English Workspace',
    title: '영어 들어가기',
    description: '문제생성, 문제은행, 라이브러리, 문제지 제작까지 영어 수업 운영의 핵심 흐름을 빠르게 연결합니다.',
    buttonLabel: '영어 서비스 열기',
    buttonVariant: 'default',
    icon: Languages,
    highlights: ['AI 문제생성', '문제은행', '문제지 제작'],
    accentClass: 'from-indigo-500/20 via-blue-500/10 to-sky-400/20',
  },
  {
    subject: 'korean',
    label: 'Korean Workspace',
    title: '국어 들어가기',
    description: '문제마켓, 자료관리, 라이브러리, 문제지 흐름을 한 워크스페이스에서 자연스럽게 이어갑니다.',
    buttonLabel: '국어 서비스 열기',
    buttonVariant: 'outline',
    icon: LibraryBig,
    highlights: ['문제마켓', '자료관리', '라이브러리'],
    accentClass: 'from-emerald-500/20 via-teal-500/10 to-cyan-400/20',
  },
]

const valuePoints = [
  {
    icon: Sparkles,
    title: '더 빠른 시작',
    description: '과목별 워크스페이스를 바로 선택해 필요한 서비스만 빠르게 진입할 수 있습니다.',
  },
  {
    icon: BookOpen,
    title: '흐름 중심 구성',
    description: '생성, 정리, 보관, 문제지 제작까지 실제 수업 운영 흐름을 따라 이동합니다.',
  },
  {
    icon: FileText,
    title: '한눈에 비교',
    description: '영어와 국어의 핵심 가치와 진입 포인트를 비교한 뒤 바로 선택할 수 있습니다.',
  },
]

export function MainLanding() {
  return (
    <div className="relative overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.35),_transparent_55%),radial-gradient(circle_at_80%_20%,_rgba(45,212,191,0.28),_transparent_35%)]" />
      <div className="absolute left-1/2 top-24 h-64 w-64 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />

      <section className="relative container mx-auto px-4 pb-20 pt-16 md:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <Badge className="border-white/20 bg-white/10 px-4 py-1 text-sm text-white backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" />
            AI English & Korean Workspace
          </Badge>
          <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-6xl word-keep-all">
            써머썬 연구소
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-slate-200 md:text-xl word-keep-all">
            영어와 국어 서비스 진입점을 한곳에 모았습니다.
            어떤 수업을 준비하든, 필요한 워크스페이스를 고르고 바로 다음 작업으로 이어가세요.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-200">
            <span className="rounded-full border border-white/15 bg-white/5 px-4 py-2">영어 문제생성부터 문제지 제작까지</span>
            <span className="rounded-full border border-white/15 bg-white/5 px-4 py-2">국어 문제마켓과 자료관리 흐름</span>
            <span className="rounded-full border border-white/15 bg-white/5 px-4 py-2">한 번의 선택으로 더 빠른 진입</span>
          </div>
        </div>

        <div className="mx-auto mt-14 grid max-w-6xl gap-6 text-left lg:grid-cols-2">
          {workspaceCards.map((card) => {
            const Icon = card.icon

            return (
              <Card key={card.subject} className="group relative h-full overflow-hidden rounded-[2rem] border-white/10 bg-white/95 py-0 text-slate-900 shadow-2xl shadow-slate-950/20 transition duration-300 hover:-translate-y-1 hover:shadow-indigo-500/10">
                  <div className={`absolute inset-0 bg-gradient-to-br ${card.accentClass}`} />
                  <CardContent className="relative flex h-full flex-col p-8 md:p-10">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold text-primary">
                          {card.label}
                        </div>
                        <h2 className="mt-3 text-3xl font-bold md:text-4xl word-keep-all">
                          {card.title}
                        </h2>
                      </div>
                      <div className="rounded-2xl bg-slate-900 p-3 text-white shadow-lg">
                        <Icon className="h-6 w-6" />
                      </div>
                    </div>

                    <p className="mt-5 text-base leading-7 text-slate-700 word-keep-all">
                      {card.description}
                    </p>

                    <div className="mt-6 flex flex-wrap gap-2">
                      {card.highlights.map((highlight) => (
                        <span key={highlight} className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-sm font-medium text-slate-700 backdrop-blur-sm">
                          {highlight}
                        </span>
                      ))}
                    </div>

                    <div className="mt-8 flex items-center justify-between gap-4 border-t border-slate-200 pt-6">
                      <Button asChild size="lg" variant={card.buttonVariant} className="px-6">
                        <Link href={`/${card.subject}`}>
                          {card.buttonLabel}
                        </Link>
                      </Button>
                      <Link
                        href={`/${card.subject}`}
                        className="flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900"
                      >
                        자세히 보기
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="relative border-t border-white/10 bg-white/5 py-16 backdrop-blur-sm">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <h2 className="text-2xl font-bold md:text-3xl word-keep-all">
              왜 워크스페이스로 바로 들어가야 할까요?
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-200 word-keep-all">
              필요한 기능을 먼저 보여주고, 다음 작업까지 자연스럽게 이어주는 진입 경험으로 정리했습니다.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {valuePoints.map((point) => {
              const Icon = point.icon

              return (
                <div key={point.title} className="rounded-3xl border border-white/10 bg-white/10 p-6 text-white shadow-lg shadow-slate-950/10 backdrop-blur-sm">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold word-keep-all">
                    {point.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-200 word-keep-all">
                    {point.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
