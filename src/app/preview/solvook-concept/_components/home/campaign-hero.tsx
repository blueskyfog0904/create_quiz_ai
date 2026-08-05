import Link from 'next/link'
import { ArrowRight, Check, FileStack, Search, Sparkles } from 'lucide-react'
import { StudioContainer } from '@/components/design-system'
import { Button } from '@/components/ui/button'
import type { MarketHomeConfig, MarketHomeItem, MarketHomeMenuEntry } from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface CampaignHeroProps {
  subject: WorkspaceSubject
  categories: MarketHomeMenuEntry[]
  featuredItem: MarketHomeItem | null
  config: MarketHomeConfig
}

export function CampaignHero({ subject, categories, featuredItem, config }: CampaignHeroProps) {
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  const marketHref = `/${subject}/market/${categories[0]?.slug ?? 'entexam'}`
  const campaigns = [
    { label: '인기 다운로드', title: `${subjectLabel} 선생님들이 찾는 자료`, href: config.popular.isActive ? '#popular-downloads' : marketHref, tone: 'bg-[var(--studio-primary)]' },
    { label: '교재와 출처', title: '수업 출처별 자료 골라보기', href: config.sourceExplorer.isActive ? '#source-explorer' : marketHref, tone: 'bg-[var(--studio-success)]' },
    { label: '문제마켓 카테고리', title: `${subjectLabel} 자료 유형별 탐색`, href: marketHref, tone: 'bg-[var(--studio-highlight)]' },
    { label: '이번 주 업데이트', title: '최근 등록 자료 모아보기', href: config.recent.isActive ? '#recent-materials' : marketHref, tone: 'bg-[#28395f]' },
  ]
  const detailHref = featuredItem
    ? `/${subject}/market/${featuredItem.categorySlug}/items/${featuredItem.id}`
    : marketHref

  return (
    <section className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)] py-6 sm:py-8">
      <StudioContainer className="grid gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
        <div className="order-2 grid grid-cols-2 gap-2 lg:order-1 lg:grid-cols-1">
          {campaigns.map((campaign, index) => (
            <Link
              key={campaign.title}
              href={campaign.href}
              aria-current={index === 0 ? 'true' : undefined}
              className={`group flex min-h-[82px] items-center gap-3 rounded-md border p-3.5 outline-none transition ${index === 0 ? 'border-[var(--studio-primary-border)] bg-[var(--studio-primary-soft)]' : 'border-[var(--studio-border)] bg-[var(--studio-surface)] hover:border-[var(--studio-primary-border)] hover:bg-[var(--studio-primary-soft)]'} focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]`}
            >
              <span aria-hidden="true" className={`h-10 w-1 shrink-0 rounded-full ${campaign.tone}`} />
              <span className="min-w-0">
                <span className="block text-[10px] font-extrabold tracking-[0.1em] text-[var(--studio-muted)]">{campaign.label}</span>
                <strong className="mt-1 block break-keep text-sm font-bold leading-5 text-[var(--studio-ink)]">{campaign.title}</strong>
              </span>
              <ArrowRight aria-hidden="true" className="ml-auto hidden h-4 w-4 shrink-0 text-[var(--studio-muted)] transition-transform group-hover:translate-x-0.5 sm:block" />
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
                {subjectLabel} 문제마켓
              </span>
              <h1 className="mt-5 max-w-xl break-keep text-[34px] font-black leading-[1.14] tracking-[-0.045em] sm:text-[46px]">
                수업에 필요한 {subjectLabel} 자료를
                <span className="block text-[#9af0d6]">한곳에서 탐색하세요</span>
              </h1>
              <p className="mt-4 max-w-xl break-keep text-sm leading-6 text-white/75 sm:text-base">
                교재와 출처를 찾고, 실제 등록 자료를 확인한 뒤 수업 준비로 연결하세요.
              </p>
              <form action={marketHref} method="get" className="mt-6 flex max-w-xl gap-2 rounded-lg bg-[var(--studio-surface)] p-1.5 shadow-lg">
                <label htmlFor="preview-home-search" className="sr-only">{subjectLabel} 문제마켓 검색</label>
                <Search aria-hidden="true" className="ml-2.5 mt-3 h-4 w-4 shrink-0 text-[var(--studio-muted)]" />
                <input id="preview-home-search" name="title" type="search" placeholder="찾고 싶은 자료를 검색하세요" className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--studio-ink)] outline-none placeholder:text-[#8A8FA2] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]" />
                <Button type="submit" variant="brand" className="px-4 font-bold">검색</Button>
              </form>
            </div>

            <Link href={detailHref} className="group relative hidden min-h-[300px] rounded-xl border border-white/20 bg-white/[0.09] p-5 outline-none backdrop-blur-sm transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-white lg:block">
              <div className="absolute -right-5 -top-5 h-full w-full rotate-3 rounded-xl border border-white/10" />
              <div className="relative h-full rounded-lg bg-[var(--studio-surface)] p-5 text-[var(--studio-ink)] shadow-2xl">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-[var(--studio-primary-soft)] px-2.5 py-1 text-[10px] font-extrabold text-[var(--studio-primary)]">대표 자료</span>
                  <FileStack aria-hidden="true" className="h-5 w-5 text-[var(--studio-primary)]" />
                </div>
                <p className="mt-8 text-[10px] font-extrabold tracking-[0.12em] text-[var(--studio-muted)]">{featuredItem?.categoryTitle ?? `${subjectLabel} 문제마켓`}</p>
                <strong className="mt-2 block break-keep text-2xl font-black leading-tight tracking-[-0.04em]">{featuredItem?.title ?? '자료 준비 중'}</strong>
                <ul className="mt-6 space-y-2 text-xs font-semibold text-[var(--studio-text)]">
                  <li className="flex items-center gap-2"><Check aria-hidden="true" className="h-4 w-4 text-[var(--studio-success)]" />실제 공개 자료만 안내</li>
                  <li className="flex items-center gap-2"><Check aria-hidden="true" className="h-4 w-4 text-[var(--studio-success)]" />문항 {featuredItem?.questionCount ?? 0}개</li>
                  <li className="flex items-center gap-2"><Check aria-hidden="true" className="h-4 w-4 text-[var(--studio-success)]" />{featuredItem?.sourceType ?? '출처 정보 준비 중'}</li>
                </ul>
                <span className="absolute bottom-5 right-5 inline-flex items-center gap-1 text-xs font-extrabold text-[var(--studio-primary)]">자료 상세<ArrowRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" /></span>
              </div>
            </Link>
          </div>
        </div>
      </StudioContainer>
    </section>
  )
}
