import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  BookMarked,
  BookOpenText,
  Check,
  FileText,
  FolderKanban,
  LibraryBig,
  PenLine,
  Search,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = {
  title: 'Scholarly Library Preview | 써머썬 연구소',
  description: '수업 자료를 연구하고 축적하는 써머썬 연구소 메인페이지 프리뷰',
}

const workflowSteps = [
  {
    number: '01',
    title: '자료를 들여옵니다',
    description: 'PDF, 이미지, 직접 입력으로 수업의 출발점이 되는 지문과 자료를 한곳에 모읍니다.',
    icon: Search,
  },
  {
    number: '02',
    title: '문항을 설계합니다',
    description: 'AI 문제생성과 문제은행을 연결해 수업 목적에 맞는 문항을 만들고 다듬습니다.',
    icon: PenLine,
  },
  {
    number: '03',
    title: '결과물을 엮습니다',
    description: '선별한 문항을 실제 수업에 바로 사용할 수 있는 문제지와 학습지로 정리합니다.',
    icon: FileText,
  },
  {
    number: '04',
    title: '다음 수업을 위해 남깁니다',
    description: '지문, 문항, 구매 자료와 문제지를 라이브러리에 축적해 다시 꺼내 씁니다.',
    icon: Archive,
  },
]

const archiveShelves = [
  {
    label: 'PASSAGES',
    title: '지문 서고',
    count: '읽기 자료',
    description: '직접 만든 지문과 OCR 자료를 출처별로 정리합니다.',
    href: '/english/library/mypassages',
    icon: BookMarked,
    accent: 'bg-[#bf4c2d]',
  },
  {
    label: 'QUESTION BANK',
    title: '문항 아카이브',
    count: '문제은행',
    description: '생성하고 선별한 문항을 과목과 유형에 맞춰 축적합니다.',
    href: '/english/bank',
    icon: FolderKanban,
    accent: 'bg-[#243b53]',
  },
  {
    label: 'MARKET LIBRARY',
    title: '구매 자료실',
    count: '문제마켓',
    description: '문제마켓에서 고른 자료를 다시 찾기 쉬운 형태로 관리합니다.',
    href: '/korean/library/market',
    icon: LibraryBig,
    accent: 'bg-[#b28b3f]',
  },
]

const outputItems = [
  {
    index: 'A',
    title: 'AI 문항',
    description: '지문의 맥락과 문제 유형을 바탕으로 생성하고 검토한 수업용 문항',
    detail: '생성 · 검토 · 저장',
  },
  {
    index: 'B',
    title: '문제지',
    description: '문제은행에서 필요한 문항을 골라 순서와 구성을 완성한 시험지',
    detail: '선별 · 편집 · 배치',
  },
  {
    index: 'C',
    title: '배포 파일',
    description: '교실에서 바로 인쇄하고 공유할 수 있도록 정리한 PDF·Word·HWPX',
    detail: 'PDF · Word · HWPX',
  },
]

export default function ScholarlyLibraryPreviewPage() {
  return (
    <div className="overflow-hidden bg-[#f4f0e7] text-[#172033]">
      <div className="border-b border-[#172033]/15 bg-[#ebe4d6]">
        <div className="container mx-auto flex min-h-12 items-center justify-between gap-4 px-4 py-3 text-[11px] font-semibold tracking-[0.2em] text-[#384253]">
          <span>SCHOLARLY LIBRARY / PREVIEW 01</span>
          <nav className="hidden items-center gap-6 tracking-[0.12em] md:flex" aria-label="프리뷰 섹션">
            <a href="#workflow" className="transition hover:text-[#bf4c2d]">WORKFLOW</a>
            <a href="#archive" className="transition hover:text-[#bf4c2d]">ARCHIVE</a>
            <a href="#outputs" className="transition hover:text-[#bf4c2d]">OUTPUTS</a>
          </nav>
        </div>
      </div>

      <section className="relative border-b border-[#172033]/15">
        <div className="pointer-events-none absolute inset-0 opacity-[0.045] [background-image:linear-gradient(#172033_1px,transparent_1px),linear-gradient(90deg,#172033_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="container relative mx-auto grid min-h-[650px] gap-12 px-4 py-16 lg:grid-cols-[1.12fr_0.88fr] lg:items-center lg:py-24">
          <div className="max-w-4xl">
            <div className="mb-7 flex items-center gap-3 text-xs font-bold tracking-[0.22em] text-[#bf4c2d]">
              <span className="h-px w-10 bg-[#bf4c2d]" />
              SUMMERSUN RESEARCH INSTITUTE
            </div>
            <h1 className="max-w-4xl [font-family:Georgia,'Times_New_Roman',serif] text-[clamp(3.25rem,7vw,6.9rem)] font-semibold leading-[0.96] tracking-[-0.055em] text-[#172033]">
              수업 자료를 쌓아
              <span className="mt-2 block italic text-[#bf4c2d]">교사의 자산으로.</span>
            </h1>
            <p className="mt-8 max-w-2xl break-keep text-base leading-8 text-[#596273] md:text-lg">
              지문을 찾고, 문항을 만들고, 문제지를 완성하는 일.
              흩어졌던 수업 준비의 모든 기록을 하나의 연구 흐름으로 연결합니다.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button asChild size="lg" className="h-12 rounded-none bg-[#172033] px-6 text-white hover:bg-[#bf4c2d]">
                <Link href="/english">
                  영어 연구실 열기
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-none border-[#172033]/25 bg-transparent px-6 hover:bg-[#ebe4d6] hover:text-[#172033]">
                <Link href="/korean">
                  국어 자료실 보기
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-lg">
            <div className="absolute -left-5 -top-5 h-full w-full border border-[#bf4c2d]/40" />
            <div className="relative border border-[#172033]/20 bg-[#fbf8f1] p-6 shadow-[16px_18px_0_rgba(23,32,51,0.08)] md:p-8">
              <div className="flex items-start justify-between border-b border-[#172033]/15 pb-5">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.2em] text-[#bf4c2d]">TODAY&apos;S RESEARCH DESK</p>
                  <h2 className="mt-2 [font-family:Georgia,'Times_New_Roman',serif] text-3xl font-semibold">수업 준비 기록</h2>
                </div>
                <BookOpenText className="h-8 w-8 text-[#bf4c2d]" />
              </div>

              <div className="space-y-0 py-4">
                {['지문 등록과 OCR', 'AI 문항 생성', '문제은행 선별', '문제지 완성'].map((item, index) => (
                  <div key={item} className="flex items-center gap-4 border-b border-dashed border-[#172033]/15 py-4 last:border-b-0">
                    <span className="flex h-7 w-7 items-center justify-center border border-[#172033]/20 text-[10px] font-bold">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="flex-1 text-sm font-semibold">{item}</span>
                    {index < 3 ? (
                      <Check className="h-4 w-4 text-[#bf4c2d]" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-[#b28b3f]" />
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-end justify-between border-t border-[#172033]/15 pt-5">
                <div>
                  <p className="text-[10px] tracking-[0.16em] text-[#737b87]">RESEARCH NOTE</p>
                  <p className="mt-1 text-sm font-medium">기록이 쌓일수록 수업 준비는 짧아집니다.</p>
                </div>
                <span className="[font-family:Georgia,'Times_New_Roman',serif] text-4xl italic text-[#bf4c2d]">S.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#172033]/15 bg-[#172033] text-[#f7f2e8]">
        <div className="container mx-auto grid divide-y divide-white/15 px-4 md:grid-cols-4 md:divide-x md:divide-y-0">
          {[
            ['01', '지문에서 출발'],
            ['02', '문항으로 확장'],
            ['03', '문제지로 완성'],
            ['∞', '라이브러리에 축적'],
          ].map(([value, label]) => (
            <div key={label} className="flex items-baseline gap-4 px-2 py-7 md:px-6">
              <strong className="[font-family:Georgia,'Times_New_Roman',serif] text-3xl font-normal text-[#d7ad59]">{value}</strong>
              <span className="text-xs font-semibold tracking-[0.08em] text-slate-300">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="workflow" className="scroll-mt-20 border-b border-[#172033]/15 py-20 md:py-28">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-xs font-bold tracking-[0.2em] text-[#bf4c2d]">01 / WORKFLOW</p>
              <h2 className="mt-5 max-w-md [font-family:Georgia,'Times_New_Roman',serif] text-4xl font-semibold leading-tight tracking-[-0.035em] md:text-5xl">
                한 번의 수업을
                <span className="block italic">다음 수업의 기반으로.</span>
              </h2>
              <p className="mt-6 max-w-md break-keep leading-7 text-[#667080]">
                자료 수집부터 결과물 보관까지, 반복되는 일을 끊지 않고 하나의 연구 과정으로 이어갑니다.
              </p>
            </div>

            <div className="border-t border-[#172033]/30">
              {workflowSteps.map((step) => {
                const Icon = step.icon

                return (
                  <article key={step.number} className="group grid gap-5 border-b border-[#172033]/20 py-7 sm:grid-cols-[60px_1fr_auto] sm:items-start md:py-9">
                    <span className="[font-family:Georgia,'Times_New_Roman',serif] text-xl italic text-[#bf4c2d]">{step.number}</span>
                    <div>
                      <h3 className="text-xl font-bold tracking-[-0.02em]">{step.title}</h3>
                      <p className="mt-3 max-w-xl break-keep leading-7 text-[#667080]">{step.description}</p>
                    </div>
                    <div className="flex h-12 w-12 items-center justify-center border border-[#172033]/20 transition group-hover:border-[#bf4c2d] group-hover:bg-[#bf4c2d] group-hover:text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="archive" className="scroll-mt-20 border-b border-[#172033]/15 bg-[#e9e1d2] py-20 md:py-28">
        <div className="container mx-auto px-4">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-bold tracking-[0.2em] text-[#bf4c2d]">02 / ARCHIVE</p>
              <h2 className="mt-5 [font-family:Georgia,'Times_New_Roman',serif] text-4xl font-semibold tracking-[-0.035em] md:text-5xl">
                교사의 수업 서고
              </h2>
            </div>
            <p className="max-w-md break-keep leading-7 text-[#667080]">
              오늘 만든 자료가 한 번 쓰고 사라지지 않도록, 성격에 맞는 서가에 기록하고 다시 꺼내 씁니다.
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {archiveShelves.map((shelf) => {
              const Icon = shelf.icon

              return (
                <Link
                  key={shelf.label}
                  href={shelf.href}
                  className="group relative flex min-h-80 flex-col overflow-hidden border border-[#172033]/20 bg-[#f8f4eb] p-7 transition hover:-translate-y-1 hover:shadow-[10px_12px_0_rgba(23,32,51,0.12)]"
                >
                  <span className={`absolute inset-x-0 top-0 h-2 ${shelf.accent}`} />
                  <div className="flex items-start justify-between">
                    <span className="text-[10px] font-bold tracking-[0.18em] text-[#737b87]">{shelf.label}</span>
                    <Icon className="h-6 w-6 text-[#bf4c2d]" />
                  </div>
                  <div className="mt-auto">
                    <span className="text-xs font-semibold text-[#bf4c2d]">{shelf.count}</span>
                    <h3 className="mt-3 [font-family:Georgia,'Times_New_Roman',serif] text-3xl font-semibold">{shelf.title}</h3>
                    <p className="mt-4 break-keep leading-7 text-[#667080]">{shelf.description}</p>
                    <div className="mt-6 flex items-center gap-2 border-t border-[#172033]/15 pt-5 text-xs font-bold tracking-[0.08em]">
                      서고 열기
                      <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-1 group-hover:-translate-y-1" />
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      <section id="outputs" className="scroll-mt-20 bg-[#f8f4eb] py-20 md:py-28">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-bold tracking-[0.2em] text-[#bf4c2d]">03 / OUTPUTS</p>
            <h2 className="mt-5 [font-family:Georgia,'Times_New_Roman',serif] text-4xl font-semibold tracking-[-0.035em] md:text-5xl">
              연구는 수업 가능한 결과로 남습니다
            </h2>
            <p className="mt-6 break-keep leading-7 text-[#667080]">
              복잡한 도구보다 중요한 것은 실제 교실에서 바로 사용할 수 있는 완성된 결과입니다.
            </p>
          </div>

          <div className="mx-auto mt-12 max-w-5xl border-y border-[#172033]/25">
            {outputItems.map((item) => (
              <article key={item.index} className="grid gap-5 border-b border-[#172033]/15 py-7 last:border-b-0 md:grid-cols-[80px_0.7fr_1.3fr_auto] md:items-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#172033]/25 [font-family:Georgia,'Times_New_Roman',serif] italic">
                  {item.index}
                </span>
                <h3 className="text-xl font-bold">{item.title}</h3>
                <p className="break-keep leading-7 text-[#667080]">{item.description}</p>
                <span className="text-xs font-bold tracking-[0.08em] text-[#bf4c2d]">{item.detail}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#bf4c2d] text-white">
        <div className="container mx-auto flex flex-col justify-between gap-8 px-4 py-14 md:flex-row md:items-center md:py-16">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-white/70">START YOUR NEXT CLASS</p>
            <h2 className="mt-3 [font-family:Georgia,'Times_New_Roman',serif] text-3xl font-semibold tracking-[-0.03em] md:text-4xl">
              다음 수업의 첫 기록을 시작하세요.
            </h2>
          </div>
          <Button asChild size="lg" className="h-12 rounded-none bg-white px-7 text-[#172033] hover:bg-[#172033] hover:text-white">
            <Link href="/english">
              연구소 들어가기
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
