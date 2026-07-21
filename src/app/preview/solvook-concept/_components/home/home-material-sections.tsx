import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Eye,
  FileText,
  Layers3,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SampleMaterialPost } from '../../_data/sample-data'
import { MaterialCover } from './material-cover'
import { SectionHeading } from './section-heading'

const previewRoot = '/preview/solvook-concept'
const boardHref = `${previewRoot}/boards/ebs-literature`

const textbookDescriptions: Record<string, string> = {
  'EBS 수능특강': '수능 연계 작품과 핵심 문항',
  'EBS 수능완성': '실전 독해와 작품 비교 자료',
  '교과서 문학': '수업 진도에 맞춘 작품 자료',
  '교과서 공통국어': '고1 기초 독해와 문학 개념',
}

const textbookTones = [
  'from-[#6950E5] to-[#8c78ee]',
  'from-[#238879] to-[#63CDB7]',
  'from-[#d05449] to-[#F38B73]',
  'from-[#28395f] to-[#55729e]',
]

function formatPublishedAt(value: string) {
  const [year, month, day] = value.split('-')
  return `${year}.${Number(month)}.${Number(day)}`
}

interface RecommendedMaterialsProps {
  posts: SampleMaterialPost[]
}

export function RecommendedMaterials({ posts }: RecommendedMaterialsProps) {
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 sm:py-14">
      <SectionHeading
        eyebrow="TEACHER'S PICK"
        title="선생님들이 먼저 살펴보는 자료"
        description="교재 정보와 지문·문항 구성을 카드에서 빠르게 비교해 보세요."
        href={boardHref}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {posts.map((post) => {
          const detailHref = `${boardHref}/posts/${post.id}`

          return (
            <article key={post.id} className="min-w-0">
              <Link
                href={detailHref}
                className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)] focus-visible:ring-offset-4"
              >
                <div className="overflow-hidden rounded-lg border border-[var(--preview-border)] bg-white p-2 transition group-hover:-translate-y-1 group-hover:border-[#6950E5]/25 group-hover:shadow-md sm:p-3">
                  <MaterialCover cover={post.cover} />
                </div>
                <div className="px-0.5 pt-3">
                  <div className="flex flex-wrap gap-1">
                    <span className="rounded-[4px] bg-[#6950E5]/[0.08] px-1.5 py-1 text-[9px] font-extrabold text-[#6950E5] sm:text-[10px]">
                      {post.year}
                    </span>
                    <span className="rounded-[4px] bg-[#EFF1F5] px-1.5 py-1 text-[9px] font-bold text-[#5C6275] sm:text-[10px]">
                      {post.workType}
                    </span>
                  </div>
                  <h3 className="mt-2 line-clamp-2 break-keep text-sm font-extrabold leading-5 tracking-[-0.02em] text-[var(--preview-ink)] sm:text-base sm:leading-6">
                    {post.title}
                  </h3>
                  <p className="mt-1 truncate text-[11px] text-[var(--preview-muted)] sm:text-xs">
                    {post.textbook}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold text-[var(--preview-muted)] sm:text-xs">
                    <span>지문 {post.passages.length}</span>
                    <span aria-hidden="true">·</span>
                    <span>문항 {post.questions.length}</span>
                    <span aria-hidden="true">·</span>
                    <span>{post.fileFormats.join('·')}</span>
                  </p>
                </div>
              </Link>
            </article>
          )
        })}
      </div>

      <Button
        asChild
        variant="outline"
        className="mt-7 h-11 w-full border-[var(--preview-border)] bg-white font-bold text-[var(--preview-text)] hover:border-[var(--preview-primary)] hover:bg-[#6950E5]/[0.04] hover:text-[var(--preview-primary)] sm:hidden"
      >
        <Link href={boardHref}>
          추천 자료 전체 보기
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </section>
  )
}

interface TextbookExplorerProps {
  textbookCounts: Record<string, number>
}

export function TextbookExplorer({
  textbookCounts,
}: TextbookExplorerProps) {
  const textbooks = Object.entries(textbookCounts)

  return (
    <section className="border-y border-[var(--preview-border)] bg-white py-12 sm:py-16">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <SectionHeading
          eyebrow="BROWSE BY SOURCE"
          title="교재와 출처로 골라보기"
          description="지금 준비 중인 수업의 교재를 선택하면 관련 자료부터 확인할 수 있습니다."
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {textbooks.map(([textbook, count], index) => (
            <Link
              key={textbook}
              href={`${boardHref}?textbook=${encodeURIComponent(textbook)}`}
              className="group relative isolate min-h-[180px] overflow-hidden rounded-xl p-5 text-white outline-none transition-transform hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)] focus-visible:ring-offset-2"
            >
              <span
                className={`absolute inset-0 bg-gradient-to-br ${textbookTones[index % textbookTones.length]}`}
              />
              <span className="absolute -right-8 -top-10 h-28 w-28 rounded-full border-[20px] border-white/10" />
              <span className="relative flex h-full flex-col">
                <BookOpen aria-hidden="true" className="h-6 w-6 text-white/75" />
                <strong className="mt-auto block text-xl font-extrabold tracking-[-0.03em]">
                  {textbook}
                </strong>
                <span className="mt-1 text-xs text-white/75">
                  {textbookDescriptions[textbook] ?? '작품별 수업 자료'}
                </span>
                <span className="mt-4 flex items-center justify-between text-xs font-bold">
                  자료 {count}개
                  <ArrowRight
                    aria-hidden="true"
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
                  />
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

interface RecentMaterialsProps {
  posts: SampleMaterialPost[]
}

export function RecentMaterials({ posts }: RecentMaterialsProps) {
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 sm:py-16">
      <SectionHeading
        eyebrow="NEW MATERIALS"
        title="최근 등록된 수업 자료"
        description="새로 올라온 자료의 교재, 작품 유형, 문항 수를 한 번에 확인하세요."
        href={`${boardHref}?sort=latest`}
        linkLabel="최근 자료 전체 보기"
      />

      <div className="overflow-hidden rounded-xl border border-[var(--preview-border)] bg-white">
        {posts.map((post, index) => (
          <Link
            key={post.id}
            href={`${boardHref}/posts/${post.id}`}
            className="group grid min-h-[112px] grid-cols-[54px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--preview-border)] px-3 py-4 outline-none transition-colors last:border-b-0 hover:bg-[#6950E5]/[0.025] focus-visible:bg-[#6950E5]/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--preview-primary)] sm:grid-cols-[42px_76px_minmax(0,1fr)_auto] sm:gap-5 sm:px-5"
          >
            <span className="hidden text-center text-xs font-extrabold text-[var(--preview-muted)] sm:block">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div
              aria-hidden="true"
              className={`grid h-14 w-14 place-items-center rounded-md ${
                index % 2 === 0
                  ? 'bg-[#6950E5]/10 text-[#6950E5]'
                  : 'bg-[#63CDB7]/20 text-[#258a78]'
              } sm:h-[70px] sm:w-[70px]`}
            >
              <FileText className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] font-extrabold text-[var(--preview-primary)]">
                  {post.textbook}
                </span>
                <span className="text-[10px] font-bold text-[var(--preview-muted)]">
                  {post.workType} · {post.grade}
                </span>
              </div>
              <h3 className="mt-1 truncate text-sm font-extrabold tracking-[-0.02em] text-[var(--preview-ink)] sm:text-base">
                {post.title}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-[var(--preview-muted)] sm:text-xs">
                <span className="inline-flex items-center gap-1">
                  <Layers3 aria-hidden="true" className="h-3.5 w-3.5" />
                  지문 {post.passages.length} · 문항 {post.questions.length}
                </span>
                <span className="hidden items-center gap-1 xs:inline-flex">
                  <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                  {post.viewCount.toLocaleString('ko-KR')}
                </span>
                <span className="hidden items-center gap-1 sm:inline-flex">
                  <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
                  {formatPublishedAt(post.publishedAt)}
                </span>
              </div>
            </div>
            <ArrowRight
              aria-hidden="true"
              className="h-4 w-4 text-[var(--preview-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--preview-primary)]"
            />
          </Link>
        ))}
      </div>
    </section>
  )
}

export function HomeFinalCta() {
  return (
    <section className="px-4 pb-14 sm:px-6 sm:pb-20">
      <div className="relative mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 overflow-hidden rounded-xl bg-[#1C1F2E] px-6 py-9 text-white sm:px-10 sm:py-11 md:flex-row md:items-center">
        <div className="absolute -right-14 -top-20 h-56 w-56 rounded-full border-[36px] border-white/[0.04]" />
        <div className="relative">
          <p className="text-xs font-extrabold tracking-[0.14em] text-[#9af0d6]">
            START YOUR CLASS MATERIAL
          </p>
          <h2 className="mt-3 break-keep text-2xl font-black tracking-[-0.035em] sm:text-3xl">
            필요한 작품부터 찾아 수업 자료를 완성하세요
          </h2>
          <p className="mt-2 break-keep text-sm leading-6 text-white/65">
            시안용 자료 12개를 검색하고, 대표 자료의 지문 구조와 문항을
            확인할 수 있습니다.
          </p>
        </div>
        <Button
          asChild
          size="lg"
          className="relative h-12 bg-[#6950E5] px-6 font-extrabold text-white hover:bg-[#8069ed]"
        >
          <Link href={boardHref}>
            게시판 전체 보기
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  )
}
