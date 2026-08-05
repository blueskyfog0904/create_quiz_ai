import Link from 'next/link'
import { ArrowRight, BookOpen, CalendarDays, FileText, Layers3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type {
  MarketHomeItem,
  MarketHomeMenuEntry,
  MarketHomeSourceConfig,
  MarketHomeSourcePath,
} from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { SectionHeading } from './section-heading'

const textbookTones = [
  'from-[var(--studio-primary)] to-[#8c78ee]',
  'from-[#238879] to-[var(--studio-success)]',
  'from-[#d05449] to-[#F38B73]',
  'from-[#28395f] to-[#55729e]',
]

function formatPublishedAt(value: string | null) {
  if (!value) return '게시일 미정'
  const date = new Date(value)
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`
}

function sourceHref(subject: WorkspaceSubject, path: MarketHomeSourcePath) {
  const query = new URLSearchParams({ sourceType: path.sourceType })
  path.sourceIndexes.forEach((sourceIndex, index) => {
    query.set(`source${sourceIndex}`, path.sourceValues[index])
  })
  return `/${subject}/market/${path.categorySlug}?${query.toString()}`
}

export function TextbookExplorer({
  subject,
  configs,
  paths,
}: {
  subject: WorkspaceSubject
  configs: MarketHomeSourceConfig[]
  paths: MarketHomeSourcePath[]
}) {
  const cards = paths.length > 0
    ? paths
    : configs.map((config) => ({
      sourceType: config.typeName,
      sourceIndexes: config.sourceIndexes,
      sourceValues: [],
      menuEntryId: '',
      categorySlug: '',
      categoryTitle: '',
      itemCount: 0,
    }))

  return (
    <section id="source-explorer" className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)] sm:p-8">
      <SectionHeading eyebrow="BROWSE BY SOURCE" title="교재와 출처로 골라보기" description="지금 준비 중인 수업의 교재와 출처를 선택해 관련 자료를 확인하세요." />
      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--studio-border)] px-5 py-12 text-center text-sm text-[var(--studio-muted)]">
          출처별 자료를 준비하고 있습니다.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.slice(0, 8).map((path, index) => {
            const content = (
              <>
                <span className={`absolute inset-0 bg-gradient-to-br ${textbookTones[index % textbookTones.length]}`} />
                <span className="absolute -right-8 -top-10 h-28 w-28 rounded-full border-[20px] border-white/10" />
                <span className="relative flex h-full flex-col">
                  <BookOpen aria-hidden="true" className="h-6 w-6 text-white/75" />
                  <strong className="mt-auto block text-xl font-extrabold tracking-[-0.03em]">{path.sourceValues.at(-1) ?? path.sourceType}</strong>
                  <span className="mt-1 text-xs text-white/75">{path.sourceValues.length > 0 ? path.sourceValues.join(' › ') : '출처 설정 자료'}</span>
                  <span className="mt-4 flex items-center justify-between text-xs font-bold">자료 {path.itemCount}개<ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-1" /></span>
                </span>
              </>
            )
            const className = 'group relative isolate min-h-[180px] overflow-hidden rounded-xl bg-gradient-to-br p-5 text-white outline-none transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2'
            return path.itemCount > 0
              ? <Link key={`${path.sourceType}-${index}`} href={sourceHref(subject, path)} className={className}>{content}</Link>
              : <div key={`${path.sourceType}-${index}`} className={className}>{content}</div>
          })}
        </div>
      )}
    </section>
  )
}

export function RecentMaterials({
  subject,
  items,
}: {
  subject: WorkspaceSubject
  items: MarketHomeItem[]
}) {
  return (
    <section id="recent-materials">
      <SectionHeading eyebrow="NEW MATERIALS" title="최근 등록된 수업 자료" description="새로 올라온 자료의 카테고리, 출처, 문항 수를 한 번에 확인하세요." />
      <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
        {items.length === 0 ? (
          <div className="grid min-h-[112px] place-items-center px-5 text-sm text-[var(--studio-muted)]">최근 등록된 자료가 없습니다.</div>
        ) : items.map((item, index) => (
          <Link key={item.id} href={`/${subject}/market/${item.categorySlug}/items/${item.id}`} className="group grid min-h-[112px] grid-cols-[54px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--studio-border)] px-3 py-4 outline-none transition-colors last:border-b-0 hover:bg-[var(--studio-primary-soft)] focus-visible:bg-[var(--studio-primary-soft)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-focus-ring)] sm:grid-cols-[42px_76px_minmax(0,1fr)_auto] sm:gap-5 sm:px-5">
            <span className="hidden text-center text-xs font-extrabold text-[var(--studio-muted)] sm:block">{String(index + 1).padStart(2, '0')}</span>
            <div aria-hidden="true" className={`grid h-14 w-14 place-items-center rounded-md ${index % 2 === 0 ? 'bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]' : 'bg-[var(--studio-success)]/20 text-[#258a78]'} sm:h-[70px] sm:w-[70px]`}>
              <FileText className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] font-extrabold text-[var(--studio-primary)]">{item.categoryTitle}</span>
                <span className="text-[10px] font-bold text-[var(--studio-muted)]">{[item.sourceType, ...item.sources].filter(Boolean).join(' · ') || '출처 정보 없음'}</span>
              </div>
              <h3 className="mt-1 truncate text-sm font-extrabold tracking-[-0.02em] text-[var(--studio-ink)] sm:text-base">{item.title}</h3>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-[var(--studio-muted)] sm:text-xs">
                <span className="inline-flex items-center gap-1"><Layers3 aria-hidden="true" className="h-3.5 w-3.5" />문항 {item.questionCount ?? 0}</span>
                <span className="hidden items-center gap-1 sm:inline-flex"><CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />{formatPublishedAt(item.publishedAt)}</span>
              </div>
            </div>
            <ArrowRight aria-hidden="true" className="h-4 w-4 text-[var(--studio-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--studio-primary)]" />
          </Link>
        ))}
      </div>
    </section>
  )
}

export function HomeFinalCta({
  subject,
  itemCount,
  categories,
}: {
  subject: WorkspaceSubject
  itemCount: number
  categories: MarketHomeMenuEntry[]
}) {
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  const href = `/${subject}/market/${categories[0]?.slug ?? 'entexam'}`
  return (
    <section>
      <div className="relative flex flex-col items-start justify-between gap-6 overflow-hidden rounded-xl bg-[var(--studio-ink)] px-6 py-9 text-white sm:px-10 sm:py-11 md:flex-row md:items-center">
        <div className="absolute -right-14 -top-20 h-56 w-56 rounded-full border-[36px] border-white/[0.04]" />
        <div className="relative">
          <p className="text-xs font-extrabold tracking-[0.14em] text-[#9af0d6]">START YOUR CLASS MATERIAL</p>
          <h2 className="mt-3 break-keep text-2xl font-black tracking-[-0.035em] sm:text-3xl">필요한 {subjectLabel} 자료부터 찾아 수업을 준비하세요</h2>
          <p className="mt-2 break-keep text-sm leading-6 text-white/65">현재 공개된 {subjectLabel} 문제마켓 자료 {itemCount.toLocaleString('ko-KR')}개를 살펴볼 수 있습니다.</p>
        </div>
        <Button asChild size="lg" variant="brand" className="relative h-12 px-6 font-extrabold">
          <Link href={href}>문제마켓 전체 보기<ArrowRight aria-hidden="true" /></Link>
        </Button>
      </div>
    </section>
  )
}
