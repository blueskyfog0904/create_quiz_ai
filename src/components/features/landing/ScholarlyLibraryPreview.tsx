import Link from 'next/link'
import {
  Archive,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronRight,
  Download,
  Eye,
  FileCheck2,
  GraduationCap,
  LibraryBig,
  PackageCheck,
  ScanText,
  ShoppingBag,
  Sparkles,
  Store,
  Tags,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const aiSteps = [
  {
    number: '01',
    icon: ScanText,
    title: '지문 준비',
    description: '직접 입력하거나 PDF·이미지를 OCR로 불러옵니다.',
  },
  {
    number: '02',
    icon: Tags,
    title: '유형 선택',
    description: '수업 목적에 맞는 문제 유형과 난이도를 고릅니다.',
  },
  {
    number: '03',
    icon: BrainCircuit,
    title: 'AI 생성',
    description: '개인지문 또는 모의고사 흐름으로 문항을 생성합니다.',
  },
  {
    number: '04',
    icon: FileCheck2,
    title: '검토와 저장',
    description: '필요한 문항만 골라 라이브러리와 시험지에 담습니다.',
  },
]

const marketBenefits = [
  {
    icon: GraduationCap,
    title: '내신 문제 전문가 제작',
    description: '학교 시험을 이해하는 전문가가 제작한 문제지를 과목과 학년별로 탐색합니다.',
  },
  {
    icon: Eye,
    title: '무료 샘플 먼저 확인',
    description: '구매 전에 PDF 샘플 페이지를 확인하고 자료의 구성과 난이도를 비교합니다.',
  },
  {
    icon: PackageCheck,
    title: '필요한 방식으로 구매',
    description: '원하는 자료만 개별 구매하거나 전체 패키지로 한 번에 준비합니다.',
  },
  {
    icon: Download,
    title: '바로 다운로드',
    description: '구매한 PDF와 HWP 자료를 내려받고 라이브러리에서 다시 관리합니다.',
  },
]

const marketItems = [
  {
    subject: '영어 내신',
    title: '고1 학교별 중간고사 대비 문제지',
    details: ['본문 분석', '서술형 대비', '변형 문제'],
    format: 'HWP · PDF',
    color: 'bg-[#1e3a5f]',
  },
  {
    subject: '영어 내신',
    title: '고2 모의고사 지문 변형 패키지',
    details: ['어법', '빈칸', '문장 삽입'],
    format: 'HWP · PDF',
    color: 'bg-[#245b4e]',
  },
  {
    subject: '국어 내신',
    title: '문학 작품별 시험 대비 자료',
    details: ['작품 분석', '핵심 개념', '실전 문항'],
    format: 'PDF · ZIP',
    color: 'bg-[#b7791f]',
  },
]

const marketSteps = [
  ['01', '과목·학년별 탐색'],
  ['02', '무료 샘플 확인'],
  ['03', '개별 구매 또는 전체 패키지'],
  ['04', '다운로드·라이브러리 보관'],
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
                AI English & Problem Market
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-[#5f625c] md:flex">
            <a href="#services" className="transition-colors hover:text-[#245b4e]">핵심 서비스</a>
            <a href="#ai-generation" className="transition-colors hover:text-[#245b4e]">AI 영어문제</a>
            <a href="#problem-market" className="transition-colors hover:text-[#245b4e]">문제마켓</a>
          </nav>

          <Button asChild className="h-10 rounded-full bg-[#245b4e] px-4 text-[#fffdf8] shadow-sm hover:bg-[#193f37] sm:px-5">
            <Link href="#services">
              <span className="hidden sm:inline">서비스 선택하기</span>
              <span className="sm:hidden">서비스</span>
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="relative border-b border-[#dcd8ca]">
          <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,#d8d3c4_1px,transparent_1px),linear-gradient(to_bottom,#d8d3c4_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-[#edf2ea] to-transparent" />

          <div className="relative mx-auto grid min-h-[720px] max-w-[1440px] items-center gap-14 px-5 py-18 sm:px-8 lg:grid-cols-[1.04fr_0.96fr] lg:px-12 lg:py-24">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#b7791f]/25 bg-[#fffdf8]/80 px-3 py-1.5 text-xs font-semibold text-[#8b611f] shadow-sm backdrop-blur">
                <Sparkles className="size-3.5" />
                AI로 만들고, 전문가의 문제지를 고르는 곳
              </div>

              <p className="mt-8 text-xs font-bold uppercase tracking-[0.24em] text-[#245b4e]">
                Create or Select · Two Ways to Prepare
              </p>
              <h1 className="mt-5 font-serif text-5xl font-semibold leading-[1.08] tracking-[-0.055em] text-[#173c34] sm:text-6xl lg:text-[72px]">
                직접 만들거나,
                <span className="relative mt-2 block text-[#1e3a5f]">
                  전문가의 문제지를 고르거나.
                  <span className="absolute -bottom-2 left-0 h-1 w-24 rounded-full bg-[#b7791f]" />
                </span>
              </h1>
              <p className="mt-9 max-w-2xl text-base leading-8 text-[#62675f] sm:text-lg">
                내 지문에 꼭 맞는 문제는 AI 영어문제 생성으로 만들고,
                검증된 내신 자료가 필요할 때는 최고의 내신 문제 전문가가 제작한 문제지를 문제마켓에서 선택하세요.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button asChild size="lg" className="h-12 rounded-full bg-[#245b4e] px-6 text-[#fffdf8] shadow-[0_10px_25px_rgba(36,91,78,0.18)] hover:bg-[#193f37]">
                  <Link href="/english/generate/personal">
                    AI 영어문제 생성
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" className="h-12 rounded-full bg-[#1e3a5f] px-6 text-white shadow-[0_10px_25px_rgba(30,58,95,0.16)] hover:bg-[#142f4d]">
                  <Link href="/english/market">
                    영어문제마켓 둘러보기
                    <ShoppingBag className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" className="h-12 rounded-full bg-[#b7791f] px-6 text-white shadow-[0_10px_25px_rgba(183,121,31,0.16)] hover:bg-[#966117]">
                  <Link href="/korean/market">
                    국어문제마켓 둘러보기
                    <ShoppingBag className="size-4" />
                  </Link>
                </Button>
              </div>

              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#6b6f68]">
                {['AI 생성은 현재 영어만 제공', '문제마켓은 영어·국어 이용 가능', '구매 전 무료 샘플 확인'].map((item) => (
                  <span key={item} className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-[#dfe9e4] text-[#245b4e]">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[610px] lg:ml-auto">
              <div className="absolute -left-7 top-8 hidden h-[86%] w-full rotate-[-3deg] rounded-[30px] border border-[#c9c3b5] bg-[#e9e4d8] sm:block" />
              <div className="relative overflow-hidden rounded-[30px] border border-[#cfc9ba] bg-[#fffdf8] shadow-[0_30px_80px_rgba(63,58,44,0.17)]">
                <div className="flex items-center justify-between border-b border-[#ded9cc] px-5 py-4 sm:px-7">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8c836f]">SummerSun Services</p>
                    <h2 className="mt-1 font-serif text-xl font-bold text-[#263b35]">오늘 어떤 방식으로 준비할까요?</h2>
                  </div>
                  <span className="rounded-full border border-[#b7791f]/20 bg-[#f8efdc] px-3 py-1 text-[10px] font-bold text-[#8b611f]">2가지 선택</span>
                </div>

                <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
                  <div className="flex min-h-72 flex-col rounded-[22px] bg-[#245b4e] p-5 text-white shadow-lg shadow-[#245b4e]/15">
                    <div className="flex items-center justify-between">
                      <span className="flex size-11 items-center justify-center rounded-2xl bg-white/12">
                        <BrainCircuit className="size-5" />
                      </span>
                      <span className="rounded-full bg-white/12 px-2.5 py-1 text-[9px] font-bold">ENGLISH ONLY</span>
                    </div>
                    <p className="mt-8 text-[9px] font-bold uppercase tracking-[0.16em] text-white/60">Create with AI</p>
                    <h3 className="mt-2 font-serif text-2xl font-bold">AI 영어문제 생성</h3>
                    <p className="mt-3 text-xs leading-6 text-white/70">내 지문과 원하는 유형에 맞는 문항을 직접 생성합니다.</p>
                    <div className="mt-auto flex items-center gap-2 pt-6 text-xs font-bold">
                      직접 만들기
                      <ArrowRight className="size-3.5" />
                    </div>
                  </div>

                  <div className="flex min-h-72 flex-col rounded-[22px] bg-[#1e3a5f] p-5 text-white shadow-lg shadow-[#1e3a5f]/15">
                    <div className="flex items-center justify-between">
                      <span className="flex size-11 items-center justify-center rounded-2xl bg-white/10">
                        <Store className="size-5" />
                      </span>
                      <span className="rounded-full bg-[#d7b66f] px-2.5 py-1 text-[9px] font-bold text-[#17324c]">ENGLISH · KOREAN</span>
                    </div>
                    <p className="mt-8 text-[9px] font-bold uppercase tracking-[0.16em] text-white/60">Select from Experts</p>
                    <h3 className="mt-2 font-serif text-2xl font-bold">문제마켓</h3>
                    <p className="mt-3 text-xs leading-6 text-white/70">내신 전문가가 제작한 문제지를 확인하고 구매합니다.</p>
                    <div className="mt-auto flex items-center gap-2 pt-6 text-xs font-bold text-[#e8cc8e]">
                      전문가 자료 고르기
                      <ArrowRight className="size-3.5" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="services" className="mx-auto max-w-[1440px] px-5 py-22 sm:px-8 lg:px-12 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#b7791f]">Two Core Services</p>
            <h2 className="mt-4 font-serif text-4xl font-semibold tracking-[-0.045em] text-[#193f37] sm:text-5xl">
              수업 준비에 필요한 두 가지 방식
            </h2>
            <p className="mt-5 text-base leading-8 text-[#6d7068]">
              직접 만들고 싶은 순간과 검증된 자료를 빠르게 확보하고 싶은 순간을 모두 지원합니다.
            </p>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-2">
            <article className="relative overflow-hidden rounded-[32px] border border-[#bfcfc7] bg-[#e8f0ec] p-7 sm:p-9">
              <div className="absolute -right-20 -top-24 size-64 rounded-full border border-[#245b4e]/10" />
              <div className="absolute -right-8 -top-10 size-40 rounded-full border border-[#245b4e]/10" />
              <div className="relative">
                <div className="flex items-center justify-between gap-4">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-[#245b4e] text-white shadow-md">
                    <BrainCircuit className="size-6" />
                  </span>
                  <span className="rounded-full border border-[#245b4e]/20 bg-white/65 px-3 py-1.5 text-[10px] font-bold text-[#245b4e]">
                    현재 영어만 제공
                  </span>
                </div>
                <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.18em] text-[#52746a]">AI English Question Generation</p>
                <h3 className="mt-3 font-serif text-4xl font-bold tracking-[-0.045em] text-[#193f37]">AI 영어문제 생성</h3>
                <p className="mt-5 max-w-xl text-base leading-8 text-[#65716b]">
                  가지고 있는 영어 지문을 등록하고 필요한 문제 유형을 선택하면 AI가 문항을 생성합니다. 결과를 직접 검토하고 필요한 문제만 저장할 수 있습니다.
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {['PDF·이미지 OCR', '개인지문·모의고사 생성', '문제 유형·난이도 선택', '선택 저장·시험지 제작'].map((item) => (
                    <div key={item} className="flex items-center gap-2 rounded-xl border border-[#cad8d1] bg-white/55 px-3 py-2.5 text-xs font-semibold text-[#4b6058]">
                      <Check className="size-3.5 text-[#245b4e]" />
                      {item}
                    </div>
                  ))}
                </div>
                <Button asChild size="lg" className="mt-9 h-12 rounded-full bg-[#245b4e] px-6 text-white hover:bg-[#193f37]">
                  <Link href="/english/generate/personal">
                    영어문제 직접 만들기
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>
            </article>

            <article className="relative overflow-hidden rounded-[32px] border border-[#bcc7d0] bg-[#e7edf2] p-7 sm:p-9">
              <div className="absolute -right-20 -top-24 size-64 rounded-full border border-[#1e3a5f]/10" />
              <div className="absolute -right-8 -top-10 size-40 rounded-full border border-[#1e3a5f]/10" />
              <div className="relative">
                <div className="flex items-center justify-between gap-4">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-[#1e3a5f] text-white shadow-md">
                    <ShoppingBag className="size-6" />
                  </span>
                  <span className="rounded-full border border-[#1e3a5f]/15 bg-white/65 px-3 py-1.5 text-[10px] font-bold text-[#1e3a5f]">
                    영어·국어 이용 가능
                  </span>
                </div>
                <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.18em] text-[#63798c]">Expert-Crafted Problem Market</p>
                <h3 className="mt-3 font-serif text-4xl font-bold tracking-[-0.045em] text-[#1e3a5f]">문제마켓</h3>
                <p className="mt-5 max-w-xl text-base leading-8 text-[#687681]">
                  최고의 내신 문제 전문가가 제작한 문제지를 과목·학년·시험 범위별로 살펴보고, 샘플을 확인한 뒤 필요한 자료를 구매합니다.
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {['내신 전문가 제작 자료', '구매 전 무료 샘플', '개별 구매·전체 패키지', 'PDF·HWP 즉시 다운로드'].map((item) => (
                    <div key={item} className="flex items-center gap-2 rounded-xl border border-[#ccd5dc] bg-white/55 px-3 py-2.5 text-xs font-semibold text-[#536777]">
                      <Check className="size-3.5 text-[#1e3a5f]" />
                      {item}
                    </div>
                  ))}
                </div>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg" className="h-12 rounded-full bg-[#1e3a5f] px-6 text-white hover:bg-[#142f4d]">
                    <Link href="/english/market">
                      영어 문제마켓
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" className="h-12 rounded-full bg-[#b7791f] px-6 text-white hover:bg-[#966117]">
                    <Link href="/korean/market">국어 문제마켓</Link>
                  </Button>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section id="ai-generation" className="border-y border-[#dcd8ca] bg-[#fffdf8]">
          <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-22 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:px-12 lg:py-28">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#245b4e]/20 bg-[#e8f0ec] px-3 py-1.5 text-[10px] font-bold text-[#245b4e]">
                <BrainCircuit className="size-3.5" />
                ENGLISH AI LAB
              </span>
              <h2 className="mt-5 font-serif text-4xl font-semibold leading-tight tracking-[-0.045em] text-[#193f37] sm:text-5xl">
                내 영어 지문에 맞는 문제를 직접 만드세요.
              </h2>
              <p className="mt-6 max-w-lg text-base leading-8 text-[#6b7068]">
                AI 문제 생성은 현재 영어만 제공됩니다. 국어는 아직 AI 생성 기능을 지원하지 않으며 문제마켓을 중심으로 이용할 수 있습니다.
              </p>
              <Button asChild size="lg" className="mt-8 h-12 rounded-full bg-[#245b4e] px-6 text-white hover:bg-[#193f37]">
                <Link href="/english/generate/personal">
                  AI 영어문제 생성 시작
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {aiSteps.map((item) => {
                const Icon = item.icon

                return (
                  <article key={item.number} className="rounded-[24px] border border-[#ddd8cb] bg-[#f7f4ec] p-6">
                    <div className="flex items-center justify-between">
                      <span className="font-serif text-3xl text-[#b9b19f]">{item.number}</span>
                      <span className="flex size-11 items-center justify-center rounded-2xl bg-[#245b4e] text-white">
                        <Icon className="size-5" />
                      </span>
                    </div>
                    <h3 className="mt-8 font-serif text-xl font-bold text-[#263b35]">{item.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-[#70736b]">{item.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="problem-market" className="relative overflow-hidden bg-[#1e3a5f] text-white">
          <div className="absolute -right-40 -top-52 size-[580px] rounded-full border border-white/8" />
          <div className="absolute -right-10 -top-20 size-[340px] rounded-full border border-white/8" />

          <div className="relative mx-auto max-w-[1440px] px-5 py-22 sm:px-8 lg:px-12 lg:py-28">
            <div className="grid gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#d7b66f]/25 bg-[#d7b66f]/10 px-3 py-1.5 text-[10px] font-bold text-[#e8cc8e]">
                  <Store className="size-3.5" />
                  EXPERT PROBLEM MARKET
                </span>
                <h2 className="mt-5 font-serif text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
                  전문가가 만든 문제지를 비교하고 바로 구매하세요.
                </h2>
                <p className="mt-6 max-w-xl text-base leading-8 text-blue-100/70">
                  영어와 국어 문제마켓에서 내신 문제 전문가의 자료를 찾아보세요. 무료 샘플을 확인하고 필요한 구성만 선택할 수 있습니다.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {marketBenefits.map((benefit) => {
                  const Icon = benefit.icon

                  return (
                    <article key={benefit.title} className="rounded-[22px] border border-white/12 bg-white/[0.07] p-5 backdrop-blur-sm">
                      <Icon className="size-5 text-[#e4c581]" />
                      <h3 className="mt-5 font-serif text-lg font-bold">{benefit.title}</h3>
                      <p className="mt-2 text-xs leading-6 text-blue-100/65">{benefit.description}</p>
                    </article>
                  )
                })}
              </div>
            </div>

            <div className="mt-14 overflow-hidden rounded-[30px] border border-white/12 bg-[#f9f7f1] text-[#26332f] shadow-2xl shadow-[#102a45]/25">
              <div className="flex flex-col gap-3 border-b border-[#ded9cc] px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8b806e]">Market Preview</p>
                  <h3 className="mt-1 font-serif text-xl font-bold text-[#1e3a5f]">전문가 제작 문제지 미리보기</h3>
                </div>
                <span className="text-xs font-semibold text-[#72766f]">샘플 확인 후 상세 페이지에서 구매</span>
              </div>

              <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-3">
                {marketItems.map((item) => (
                  <article key={item.title} className="group overflow-hidden rounded-[22px] border border-[#ded9cc] bg-white transition-transform hover:-translate-y-1 hover:shadow-lg">
                    <div className={`h-2 ${item.color}`} />
                    <div className="p-5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full bg-[#f1eee6] px-2.5 py-1 text-[9px] font-bold text-[#706958]">{item.subject}</span>
                        <span className="text-[9px] font-bold text-[#1e3a5f]">{item.format}</span>
                      </div>
                      <h4 className="mt-5 min-h-14 font-serif text-lg font-bold leading-7 text-[#283934]">{item.title}</h4>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {item.details.map((detail) => (
                          <span key={detail} className="rounded-full border border-[#e1ddd2] px-2.5 py-1 text-[9px] text-[#777467]">{detail}</span>
                        ))}
                      </div>
                      <div className="mt-6 flex items-center justify-between border-t border-[#ece8de] pt-4">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#65746e]">
                          <Eye className="size-3.5" />
                          무료 샘플
                        </span>
                        <span className="flex size-8 items-center justify-center rounded-full bg-[#1e3a5f] text-white transition-colors group-hover:bg-[#b7791f]">
                          <ChevronRight className="size-4" />
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="grid border-t border-[#ded9cc] bg-[#f1eee6] sm:grid-cols-2 lg:grid-cols-4">
                {marketSteps.map(([number, label], index) => (
                  <div key={number} className={`flex items-center gap-3 px-5 py-4 ${index > 0 ? 'border-t border-[#ded9cc] sm:border-l sm:border-t-0' : ''} ${index === 2 ? 'lg:border-l' : ''}`}>
                    <span className="font-serif text-xl font-bold text-[#b7791f]">{number}</span>
                    <span className="text-xs font-semibold text-[#646a64]">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 rounded-full bg-[#d7b66f] px-7 text-[#18324d] hover:bg-[#e4c784]">
                <Link href="/english/market">
                  영어 문제마켓 둘러보기
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-white/25 bg-white/8 px-7 text-white hover:bg-white/15 hover:text-white">
                <Link href="/korean/market">국어 문제마켓 둘러보기</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="border-b border-[#dcd8ca] bg-[#eef1eb]">
          <div className="mx-auto max-w-[1440px] px-5 py-20 sm:px-8 lg:px-12 lg:py-24">
            <div className="mb-10 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#b7791f]">Choose Your Workspace</p>
              <h2 className="mt-4 font-serif text-4xl font-semibold tracking-[-0.045em] text-[#193f37]">과목에 맞는 서비스로 시작하세요.</h2>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <article className="rounded-[28px] border border-[#c7d2cc] bg-[#fffdf8] p-7 sm:p-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#245b4e]">English Workspace</p>
                    <h3 className="mt-2 font-serif text-3xl font-bold text-[#193f37]">영어 서비스</h3>
                  </div>
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-[#245b4e] text-white">
                    <BookOpen className="size-5" />
                  </span>
                </div>
                <p className="mt-5 text-sm leading-7 text-[#6a7069]">AI 영어문제 생성과 영어 문제마켓을 모두 이용할 수 있습니다.</p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Button asChild className="rounded-full bg-[#245b4e] text-white hover:bg-[#193f37]">
                    <Link href="/english/generate/personal">AI 문제 생성</Link>
                  </Button>
                  <Button asChild variant="outline" className="rounded-full border-[#b7c0bb] bg-white">
                    <Link href="/english/market">영어 문제마켓</Link>
                  </Button>
                </div>
              </article>

              <article className="rounded-[28px] border border-[#c7d0d8] bg-[#fffdf8] p-7 sm:p-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#1e3a5f]">Korean Workspace</p>
                    <h3 className="mt-2 font-serif text-3xl font-bold text-[#1e3a5f]">국어 서비스</h3>
                  </div>
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-[#1e3a5f] text-white">
                    <Archive className="size-5" />
                  </span>
                </div>
                <p className="mt-5 text-sm leading-7 text-[#6a7077]">현재 국어는 문제마켓과 구매자료 관리 중심이며 AI 문제 생성은 준비 중입니다.</p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button asChild className="rounded-full bg-[#1e3a5f] text-white hover:bg-[#142f4d]">
                    <Link href="/korean/market">국어 문제마켓</Link>
                  </Button>
                  <span className="rounded-full border border-[#d7d3c8] bg-[#f3f0e8] px-3 py-2 text-center text-[10px] font-bold text-[#827b6d]">AI 국어문제 생성 준비 중</span>
                </div>
              </article>
            </div>

            <div className="mt-6 flex flex-col items-center justify-between gap-5 rounded-[24px] border border-[#d5d0c3] bg-[#fffdf8] px-6 py-6 sm:flex-row sm:px-8">
              <div>
                <p className="font-serif text-xl font-bold text-[#293d37]">생성하거나 구매한 문제는 한곳에서 관리하세요.</p>
                <p className="mt-1 text-sm text-[#74766e]">영어 라이브러리에서 저장한 AI 문항과 구매자료를 다시 확인할 수 있습니다.</p>
              </div>
              <Button asChild variant="outline" className="shrink-0 rounded-full border-[#bcb6a8] bg-white px-5 text-[#39443f] hover:bg-[#f5f2e9]">
                <Link href="/english/library/purchased">
                  내 문항 관리
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
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
          <p>AI English & Problem Market 디자인 검토용 독립 프리뷰 · 기존 메인 페이지에는 적용되지 않았습니다.</p>
        </div>
      </footer>
    </div>
  )
}
