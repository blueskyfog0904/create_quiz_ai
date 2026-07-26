import Link from 'next/link'
import { ArrowRight, Check, FileStack, Search, Sparkles } from 'lucide-react'
import { StudioContainer } from '@/components/design-system'
import { Button } from '@/components/ui/button'
import type { SampleMaterialPost } from '../../_data/sample-data'

const previewRoot = '/preview/solvook-concept'
const boardHref = `${previewRoot}/boards/ebs-literature`

const campaigns = [
  {
    label: 'EBS 집중 탐색',
    title: '2027 수능특강 문학 자료',
    href: `${boardHref}?year=2027&textbook=EBS+수능특강`,
    tone: 'bg-[var(--studio-primary)]',
  },
  {
    label: '이번 주 업데이트',
    title: '최근 등록 자료 모아보기',
    href: `${boardHref}?sort=latest`,
    tone: 'bg-[var(--studio-success)]',
  },
  {
    label: '수업 준비 단축',
    title: '문항 많은 자료부터 보기',
    href: `${boardHref}?sort=questions`,
    tone: 'bg-[var(--studio-highlight)]',
  },
  {
    label: '교과서 연계',
    title: '고1·고2 문학 자료 탐색',
    href: `${boardHref}?grade=고2`,
    tone: 'bg-[#28395f]',
  },
] as const

interface CampaignHeroProps {
  featuredPost: SampleMaterialPost
}

export function CampaignHero({ featuredPost }: CampaignHeroProps) {
  const detailHref = `${boardHref}/posts/${featuredPost.id}`

  return (
    <section className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)] py-6 sm:py-8">
      <StudioContainer className="grid gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
        <div className="order-2 grid grid-cols-2 gap-2 lg:order-1 lg:grid-cols-1">
          {campaigns.map((campaign, index) => (
            <Link
              key={campaign.title}
              href={campaign.href}
              aria-current={index === 0 ? 'true' : undefined}
              className={`group flex min-h-[82px] items-center gap-3 rounded-md border p-3.5 outline-none transition ${
                index === 0
                  ? 'border-[var(--studio-primary-border)] bg-[var(--studio-primary-soft)]'
                  : 'border-[var(--studio-border)] bg-[var(--studio-surface)] hover:border-[var(--studio-primary-border)] hover:bg-[var(--studio-primary-soft)]'
              } focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]`}
            >
              <span
                aria-hidden="true"
                className={`h-10 w-1 shrink-0 rounded-full ${campaign.tone}`}
              />
              <span className="min-w-0">
                <span className="block text-[10px] font-extrabold tracking-[0.1em] text-[var(--studio-muted)]">
                  {campaign.label}
                </span>
                <strong className="mt-1 block break-keep text-sm font-bold leading-5 text-[var(--studio-ink)]">
                  {campaign.title}
                </strong>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="ml-auto hidden h-4 w-4 shrink-0 text-[var(--studio-muted)] transition-transform group-hover:translate-x-0.5 sm:block"
              />
            </Link>
          ))}
        </div>

        <div className="order-1 relative isolate min-h-[420px] overflow-hidden rounded-xl bg-[#3f2c96] px-5 py-7 text-white shadow-[0_18px_45px_rgba(56,37,130,0.18)] sm:px-9 sm:py-9 lg:order-2 lg:min-h-[442px]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_76%_22%,rgba(154,240,214,0.26),transparent_26%),radial-gradient(circle_at_15%_95%,rgba(244,109,94,0.22),transparent_28%)]" />
          <div className="absolute -right-24 -top-28 h-72 w-72 rounded-full border-[42px] border-white/[0.07]" />

          <div className="relative z-10 grid h-full gap-7 lg:grid-cols-[minmax(0,1.1fr)_280px] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-xs font-bold text-[#c8ffe9]">
                <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                2027 EBS 문학 큐레이션
              </span>
              <h1 className="mt-5 max-w-xl break-keep text-[34px] font-black leading-[1.14] tracking-[-0.045em] sm:text-[46px]">
                수능특강 국어 문학 자료를
                <span className="block text-[#9af0d6]">한곳에서 탐색하세요</span>
              </h1>
              <p className="mt-4 max-w-xl break-keep text-sm leading-6 text-white/75 sm:text-base">
                작품과 교재를 찾고, 지문 구조와 포함 문항을 확인한 뒤 수업
                자료로 연결하는 선생님용 자료 워크스페이스입니다.
              </p>

              <form
                action={boardHref}
                method="get"
                className="mt-6 flex max-w-xl gap-2 rounded-lg bg-[var(--studio-surface)] p-1.5 shadow-lg"
              >
                <label htmlFor="preview-home-search" className="sr-only">
                  국어 문학 자료 검색
                </label>
                <Search
                  aria-hidden="true"
                  className="ml-2.5 mt-3 h-4 w-4 shrink-0 text-[var(--studio-muted)]"
                />
                <input
                  id="preview-home-search"
                  name="q"
                  type="search"
                  placeholder="작품명이나 교재를 검색하세요"
                  className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--studio-ink)] outline-none placeholder:text-[#8A8FA2] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                />
                <Button
                  type="submit"
                  variant="brand"
                  className="px-4 font-bold"
                >
                  검색
                </Button>
              </form>
            </div>

            <Link
              href={detailHref}
              className="group relative hidden min-h-[300px] rounded-xl border border-white/20 bg-white/[0.09] p-5 outline-none backdrop-blur-sm transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-white lg:block"
            >
              <div className="absolute -right-5 -top-5 h-full w-full rotate-3 rounded-xl border border-white/10" />
              <div className="relative h-full rounded-lg bg-[var(--studio-surface)] p-5 text-[var(--studio-ink)] shadow-2xl">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[var(--studio-primary-soft)] px-2.5 py-1 text-[10px] font-extrabold text-[var(--studio-primary)]">
                    대표 자료
                  </span>
                  <FileStack
                    aria-hidden="true"
                    className="h-5 w-5 text-[var(--studio-primary)]"
                  />
                </div>
                <p className="mt-8 text-[10px] font-extrabold tracking-[0.12em] text-[var(--studio-muted)]">
                  {featuredPost.cover.eyebrow}
                </p>
                <strong className="mt-2 block break-keep text-2xl font-black leading-tight tracking-[-0.04em]">
                  {featuredPost.cover.title}
                </strong>
                <ul className="mt-6 space-y-2 text-xs font-semibold text-[var(--studio-text)]">
                  <li className="flex items-center gap-2">
                    <Check aria-hidden="true" className="h-4 w-4 text-[var(--studio-success)]" />
                    지문 {featuredPost.passages.length}개 구조 분석
                  </li>
                  <li className="flex items-center gap-2">
                    <Check aria-hidden="true" className="h-4 w-4 text-[var(--studio-success)]" />
                    연결 문항 {featuredPost.questions.length}개
                  </li>
                  <li className="flex items-center gap-2">
                    <Check aria-hidden="true" className="h-4 w-4 text-[var(--studio-success)]" />
                    구간 A·B·C 한눈에 보기
                  </li>
                </ul>
                <span className="absolute bottom-5 right-5 inline-flex items-center gap-1 text-xs font-extrabold text-[var(--studio-primary)]">
                  자료 상세
                  <ArrowRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </div>
            </Link>
          </div>
        </div>
      </StudioContainer>
    </section>
  )
}
