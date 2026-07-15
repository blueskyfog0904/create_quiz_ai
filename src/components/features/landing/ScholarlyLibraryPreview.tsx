import Link from 'next/link'
import {
  Archive,
  ArrowRight,
  BookMarked,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronRight,
  FileDown,
  FileText,
  FolderKanban,
  Layers3,
  LibraryBig,
  ScanText,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Stamp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const archiveItems = [
  {
    classification: 'ENGLISH · READING',
    title: '2026학년도 고2 독해 지문',
    detail: '빈칸 추론 · 중심 내용 · 문장 삽입',
    count: '12문항',
    accent: 'bg-[#245b4e]',
  },
  {
    classification: 'ENGLISH · GRAMMAR',
    title: '수능 핵심 어법 아카이브',
    detail: '관계사 · 분사구문 · 수 일치',
    count: '28문항',
    accent: 'bg-[#1e3a5f]',
  },
  {
    classification: 'KOREAN · LITERATURE',
    title: '현대시 작품별 문제 모음',
    detail: '표현법 · 화자의 태도 · 시상 전개',
    count: '16문항',
    accent: 'bg-[#b7791f]',
  },
]

const features = [
  {
    number: '01',
    icon: ScanText,
    title: '지문 아카이브',
    description: '직접 입력하거나 PDF·이미지를 OCR로 불러와 수업 자료를 출처와 태그별로 축적합니다.',
    meta: ['OCR 등록', '출처 관리', '태그 분류'],
  },
  {
    number: '02',
    icon: BrainCircuit,
    title: 'AI 문제 생성',
    description: '개인지문과 모의고사 흐름에 맞춰 필요한 문제 유형을 선택하고 문항을 빠르게 생성합니다.',
    meta: ['유형별 생성', '다중 생성', 'AI 검토'],
  },
  {
    number: '03',
    icon: FolderKanban,
    title: '문항 관리',
    description: '생성하거나 가져온 문제를 검토하고, 별점·태그·난이도로 정리해 다시 활용합니다.',
    meta: ['선택 저장', '필터 검색', '재사용'],
  },
  {
    number: '04',
    icon: ScrollText,
    title: '시험지 제작',
    description: '선택한 문항을 시험지로 조립하고 실제 수업 환경에 맞는 형식으로 완성합니다.',
    meta: ['문항 조립', '미리보기', '다중 포맷'],
  },
]

const workflow = [
  {
    step: '01',
    title: '자료를 준비합니다',
    description: '직접 작성하거나 OCR로 지문을 등록해 수업 자료의 출발점을 만듭니다.',
    icon: BookOpen,
  },
  {
    step: '02',
    title: 'AI가 문항을 만듭니다',
    description: '목적에 맞는 문제 유형과 난이도를 선택해 필요한 문항을 생성합니다.',
    icon: Sparkles,
  },
  {
    step: '03',
    title: '선생님이 검토합니다',
    description: '결과를 읽고 필요한 문제만 선택해 신뢰할 수 있는 자료로 축적합니다.',
    icon: Stamp,
  },
  {
    step: '04',
    title: '수업 자료로 완성합니다',
    description: '문항을 시험지로 조립해 PDF, Word, HWPX로 출력합니다.',
    icon: FileDown,
  },
]

const outputFormats = [
  { label: 'PDF', detail: '인쇄와 공유에 최적화', icon: FileText },
  { label: 'Word', detail: '내용을 자유롭게 편집', icon: BookMarked },
  { label: 'HWPX', detail: '교육 현장 문서에 활용', icon: Archive },
]

export function ScholarlyLibraryPreview() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#f7f5ef] text-[#202a27] [--font-serif:Georgia,serif]">
      <header className="sticky top-0 z-50 border-b border-[#dcd8ca]/80 bg-[#f7f5ef]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link href="/preview/scholarly-library" className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full border border-[#245b4e]/30 bg-[#245b4e] text-[#fffdf8] shadow-sm">
              <LibraryBig className="size-4.5" />
            </span>
            <span>
              <span className="block font-serif text-lg font-bold leading-none tracking-[-0.04em] text-[#193f37]">
                써머썬 연구소
              </span>
              <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-[#877f6f]">
                SummerSun Scholarly Library
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-[#5f625c] md:flex">
            <a href="#archive" className="transition-colors hover:text-[#245b4e]">아카이브</a>
            <a href="#workflow" className="transition-colors hover:text-[#245b4e]">제작 흐름</a>
            <a href="#outputs" className="transition-colors hover:text-[#245b4e]">결과물</a>
          </nav>

          <Button asChild className="h-10 rounded-full bg-[#245b4e] px-4 text-[#fffdf8] shadow-sm hover:bg-[#193f37] sm:px-5">
            <Link href="/english">
              <span className="hidden sm:inline">영어 자료실 입장</span>
              <span className="sm:hidden">입장</span>
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="relative border-b border-[#dcd8ca]">
          <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,#d8d3c4_1px,transparent_1px),linear-gradient(to_bottom,#d8d3c4_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-[#edf2ea] to-transparent" />

          <div className="relative mx-auto grid min-h-[730px] max-w-[1440px] items-center gap-14 px-5 py-18 sm:px-8 lg:grid-cols-[1.02fr_0.98fr] lg:px-12 lg:py-24">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#b7791f]/25 bg-[#fffdf8]/80 px-3 py-1.5 text-xs font-semibold text-[#8b611f] shadow-sm backdrop-blur">
                <ShieldCheck className="size-3.5" />
                선생님의 자료가 지식이 되는 곳
              </div>

              <p className="mt-8 text-xs font-bold uppercase tracking-[0.24em] text-[#245b4e]">
                Education Archive & Exam Studio
              </p>
              <h1 className="mt-5 font-serif text-5xl font-semibold leading-[1.08] tracking-[-0.055em] text-[#173c34] sm:text-6xl lg:text-[76px]">
                흩어진 수업 자료를
                <span className="relative mt-2 block text-[#1e3a5f]">
                  하나의 지식으로.
                  <span className="absolute -bottom-2 left-0 h-1 w-24 rounded-full bg-[#b7791f]" />
                </span>
              </h1>
              <p className="mt-9 max-w-xl text-base leading-8 text-[#62675f] sm:text-lg">
                지문 등록부터 AI 문제 생성, 문항 관리, 시험지 제작까지.
                선생님의 반복되는 수업 준비를 차분하고 신뢰할 수 있는 하나의 작업 흐름으로 정리합니다.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 rounded-full bg-[#245b4e] px-6 text-[#fffdf8] shadow-[0_10px_25px_rgba(36,91,78,0.18)] hover:bg-[#193f37]">
                  <Link href="/english/generate/personal">
                    AI 문제 만들기
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-[#b8b3a6] bg-[#fffdf8]/65 px-6 text-[#39443f] hover:bg-[#fffdf8] hover:text-[#193f37]">
                  <Link href="/english/library/purchased">
                    내 문항 아카이브
                    <ChevronRight className="size-4" />
                  </Link>
                </Button>
              </div>

              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#6b6f68]">
                {['영어·국어 워크스페이스', '선택 문항 저장', '시험지 다중 포맷'].map((item) => (
                  <span key={item} className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-[#dfe9e4] text-[#245b4e]">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[620px] lg:ml-auto">
              <div className="absolute -left-7 top-12 hidden h-[78%] w-full rotate-[-3deg] rounded-[28px] border border-[#c9c3b5] bg-[#e9e4d8] shadow-sm sm:block" />
              <div className="absolute -right-5 top-8 hidden h-[82%] w-full rotate-[2.5deg] rounded-[28px] border border-[#cfd8d2] bg-[#e6eee9] shadow-sm sm:block" />

              <div className="relative overflow-hidden rounded-[28px] border border-[#cfc9ba] bg-[#fffdf8] shadow-[0_30px_80px_rgba(63,58,44,0.16)]">
                <div className="flex items-center justify-between border-b border-[#ded9cc] px-5 py-4 sm:px-7">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8c836f]">My Archive</p>
                    <h2 className="mt-1 font-serif text-xl font-bold text-[#263b35]">최근 편입된 자료</h2>
                  </div>
                  <span className="rounded-full border border-[#245b4e]/20 bg-[#e8f0ec] px-3 py-1 text-[10px] font-bold text-[#245b4e]">총 56문항</span>
                </div>

                <div className="space-y-3 p-4 sm:p-6">
                  {archiveItems.map((item, index) => (
                    <div key={item.title} className="group grid grid-cols-[5px_1fr_auto] items-center gap-4 rounded-2xl border border-[#e4dfd3] bg-white p-4 transition-transform hover:-translate-y-0.5 hover:shadow-md sm:p-5">
                      <span className={`h-full min-h-16 rounded-full ${item.accent}`} />
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold tracking-[0.15em] text-[#908773]">{item.classification}</p>
                        <h3 className="mt-1.5 truncate font-serif text-base font-bold text-[#293934]">{item.title}</h3>
                        <p className="mt-1 truncate text-xs text-[#77796f]">{item.detail}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-serif text-sm font-bold text-[#34453f]">{item.count}</p>
                        <span className="mt-2 inline-flex size-7 items-center justify-center rounded-full bg-[#f2f0e9] text-[#807766] transition-colors group-hover:bg-[#245b4e] group-hover:text-white">
                          <ChevronRight className="size-3.5" />
                        </span>
                      </div>
                      <span className="sr-only">자료 {index + 1}</span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-3 border-t border-[#ded9cc] bg-[#f4f1e9]">
                  {[
                    ['오늘 생성', '18'],
                    ['검토 완료', '12'],
                    ['시험지 편입', '8'],
                  ].map(([label, value], index) => (
                    <div key={label} className={`px-3 py-4 text-center ${index > 0 ? 'border-l border-[#ded9cc]' : ''}`}>
                      <p className="font-serif text-xl font-bold text-[#245b4e]">{value}</p>
                      <p className="mt-1 text-[9px] font-semibold text-[#888174]">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-[#dcd8ca] bg-[#213f37] text-[#f7f5ef]">
          <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-y-8 px-5 py-9 sm:px-8 md:grid-cols-4 lg:px-12">
            {[
              ['01', '지문에서 시작해'],
              ['02', 'AI로 문항을 만들고'],
              ['03', '선택해 축적한 뒤'],
              ['04', '시험지로 완성합니다'],
            ].map(([number, label], index) => (
              <div key={number} className={`flex items-center gap-4 px-2 md:px-6 ${index > 0 ? 'md:border-l md:border-white/15' : ''}`}>
                <span className="font-serif text-3xl text-[#d2b477]">{number}</span>
                <span className="text-sm font-medium leading-6 text-white/80">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="archive" className="mx-auto max-w-[1440px] px-5 py-22 sm:px-8 lg:px-12 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-18">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#b7791f]">The Collection</p>
              <h2 className="mt-4 font-serif text-4xl font-semibold leading-tight tracking-[-0.045em] text-[#193f37] sm:text-5xl">
                수업 준비의 모든 조각을 한곳에 모았습니다.
              </h2>
              <p className="mt-6 max-w-md text-base leading-8 text-[#6b6e66]">
                생성 기능만 강조하지 않습니다. 자료가 쌓이고, 다시 찾아 쓰이고, 실제 시험지로 완성되는 전체 과정을 설계합니다.
              </p>
              <div className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-[#d5d0c3] bg-[#fffdf8] px-4 py-3 text-sm text-[#56605b] shadow-sm">
                <Layers3 className="size-5 text-[#245b4e]" />
                하나의 계정, 영어·국어 두 개의 자료실
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {features.map((feature, index) => {
                const Icon = feature.icon

                return (
                  <article key={feature.title} className={`group relative min-h-[310px] overflow-hidden rounded-[26px] border border-[#d8d3c7] p-6 transition-all hover:-translate-y-1 hover:border-[#9eb6ac] hover:shadow-[0_18px_45px_rgba(52,63,56,0.10)] sm:p-7 ${index === 0 || index === 3 ? 'bg-[#e7eee9]' : 'bg-[#fffdf8]'}`}>
                    <div className="flex items-start justify-between">
                      <span className="font-serif text-5xl text-[#c4bcaa]">{feature.number}</span>
                      <span className="flex size-12 items-center justify-center rounded-2xl border border-[#245b4e]/15 bg-[#245b4e] text-white shadow-sm">
                        <Icon className="size-5" />
                      </span>
                    </div>
                    <h3 className="mt-8 font-serif text-2xl font-bold tracking-[-0.035em] text-[#203b33]">{feature.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-[#6b7068]">{feature.description}</p>
                    <div className="mt-6 flex flex-wrap gap-2">
                      {feature.meta.map((item) => (
                        <span key={item} className="rounded-full border border-[#d9d4c8] bg-white/70 px-3 py-1 text-[10px] font-bold text-[#6d6c62]">
                          {item}
                        </span>
                      ))}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 bg-[#b7791f] transition-transform duration-300 group-hover:scale-x-100" />
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="workflow" className="border-y border-[#dcd8ca] bg-[#fffdf8]">
          <div className="mx-auto max-w-[1440px] px-5 py-22 sm:px-8 lg:px-12 lg:py-28">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#245b4e]">From Source to Classroom</p>
              <h2 className="mt-4 font-serif text-4xl font-semibold tracking-[-0.045em] text-[#1e3a5f] sm:text-5xl">
                자료가 수업이 되는 네 단계
              </h2>
              <p className="mt-5 text-base leading-8 text-[#6d7068]">
                복잡한 기능을 나열하기보다, 선생님이 실제로 일하는 순서에 맞춰 자연스럽게 연결합니다.
              </p>
            </div>

            <div className="relative mt-15 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="absolute left-[12%] right-[12%] top-10 hidden h-px bg-[#cfc9ba] xl:block" />
              {workflow.map((item) => {
                const Icon = item.icon

                return (
                  <article key={item.step} className="relative rounded-[24px] border border-[#ded9cc] bg-[#f8f5ed] p-6 xl:border-transparent xl:bg-transparent xl:text-center">
                    <div className="relative z-10 mx-auto flex size-20 items-center justify-center rounded-full border border-[#c7c0b0] bg-[#fffdf8] text-[#245b4e] shadow-[0_8px_25px_rgba(63,58,44,0.10)]">
                      <Icon className="size-7" />
                      <span className="absolute -right-1 -top-1 flex size-7 items-center justify-center rounded-full bg-[#b7791f] text-[9px] font-bold text-white">{item.step}</span>
                    </div>
                    <h3 className="mt-7 font-serif text-xl font-bold text-[#283d37]">{item.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-[#70736b]">{item.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="outputs" className="relative overflow-hidden bg-[#1e3a5f] text-white">
          <div className="absolute -right-32 -top-40 size-[520px] rounded-full border border-white/10" />
          <div className="absolute -right-10 -top-20 size-[340px] rounded-full border border-white/10" />
          <div className="absolute bottom-0 left-0 h-1/2 w-full bg-gradient-to-t from-[#102c49] to-transparent" />

          <div className="relative mx-auto grid max-w-[1440px] gap-14 px-5 py-22 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:px-12 lg:py-28">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d9ba7c]">Ready for Classroom</p>
              <h2 className="mt-5 max-w-xl font-serif text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
                만들기에서 끝나지 않고, 바로 사용할 수 있게.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-blue-100/75">
                완성한 시험지는 미리보기로 확인하고, 익숙한 문서 형식으로 내려받아 수업과 평가에 활용할 수 있습니다.
              </p>
              <Button asChild size="lg" className="mt-8 h-12 rounded-full bg-[#d1ae68] px-6 text-[#18324d] hover:bg-[#e1c27f]">
                <Link href="/english/library/exam-papers">
                  시험지 보관함 보기
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {outputFormats.map((format) => {
                const Icon = format.icon

                return (
                  <div key={format.label} className="group min-h-52 rounded-[24px] border border-white/15 bg-white/[0.07] p-6 backdrop-blur-sm transition-colors hover:bg-white/[0.12]">
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-white/10 text-[#e7ca8c]">
                      <Icon className="size-5" />
                    </span>
                    <p className="mt-10 font-serif text-3xl font-bold">{format.label}</p>
                    <p className="mt-2 text-sm leading-6 text-blue-100/65">{format.detail}</p>
                    <span className="mt-5 block h-px w-10 bg-[#d1ae68] transition-all group-hover:w-full" />
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="relative border-b border-[#dcd8ca] bg-[#e9eee9]">
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
            <div className="relative overflow-hidden rounded-[32px] border border-[#bfcac3] bg-[#fffdf8] px-6 py-12 text-center shadow-[0_24px_65px_rgba(60,70,62,0.10)] sm:px-10 lg:px-16 lg:py-16">
              <div className="absolute left-0 top-0 h-full w-2 bg-[#245b4e]" />
              <div className="absolute right-7 top-7 hidden size-24 rounded-full border border-[#b7791f]/25 sm:block" />
              <div className="absolute right-12 top-12 hidden size-14 rounded-full border border-[#b7791f]/25 sm:block" />
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#b7791f]">Build Your Archive</p>
              <h2 className="mx-auto mt-4 max-w-3xl font-serif text-4xl font-semibold tracking-[-0.045em] text-[#193f37] sm:text-5xl">
                오늘 만든 한 문제가 내일의 수업 자산이 됩니다.
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#696e67]">
                AI의 속도와 선생님의 판단을 연결해, 오래 쓸 수 있는 나만의 교육 자료실을 시작해보세요.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 rounded-full bg-[#245b4e] px-7 text-white hover:bg-[#193f37]">
                  <Link href="/english/generate/personal">
                    첫 문제 만들기
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-[#bcb6a8] bg-white px-7 text-[#39443f] hover:bg-[#f5f2e9]">
                  <Link href="/english/library/purchased">
                    내 자료 둘러보기
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#f7f5ef]">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-5 py-8 text-xs text-[#77786f] sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
          <div className="flex items-center gap-2 font-serif text-sm font-bold text-[#315149]">
            <LibraryBig className="size-4" />
            써머썬 연구소
          </div>
          <p>Scholarly Library 디자인 검토용 독립 프리뷰 · 기존 메인 페이지에는 적용되지 않았습니다.</p>
        </div>
      </footer>
    </div>
  )
}
