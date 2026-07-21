import Link from 'next/link'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Eye,
  FileText,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type {
  SampleBoard,
  SampleMaterialPost,
} from '../../_data/sample-data'
import { getSamplePostCounts } from '../../_data/sample-data'
import { MaterialCover } from '../home/material-cover'
import { DetailActions } from './detail-actions'
import { DetailTabs } from './detail-tabs'
import { DocumentPreviewPages } from './document-preview-pages'
import { PassageStructure } from './passage-structure'
import { QuestionList } from './question-list'
import { SamplePreviewDialog } from './sample-preview-dialog'

interface MaterialDetailProps {
  board: SampleBoard
  post: SampleMaterialPost
}

function formatPublishedAt(date: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00+09:00`))
}

export function MaterialDetail({ board, post }: MaterialDetailProps) {
  const counts = getSamplePostCounts(post)
  const passage = post.passages[0]
  const boardHref = `/preview/solvook-concept/boards/${board.slug}`

  return (
    <div className="pb-32 md:pb-0">
      <section className="border-b border-[var(--preview-border)] bg-white">
        <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
          <nav
            aria-label="현재 위치"
            className="mb-6 flex flex-wrap items-center gap-2 text-sm text-[var(--preview-muted)]"
          >
            <Link
              href="/preview/solvook-concept"
              className="rounded-sm outline-none hover:text-[var(--preview-primary)] focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)]"
            >
              홈
            </Link>
            <span aria-hidden="true">/</span>
            <Link
              href={boardHref}
              className="rounded-sm outline-none hover:text-[var(--preview-primary)] focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)]"
            >
              {board.title}
            </Link>
            <span aria-hidden="true">/</span>
            <span
              aria-current="page"
              className="max-w-full truncate font-semibold text-[var(--preview-text)]"
            >
              {post.title}
            </span>
          </nav>

          <div className="grid gap-7 md:grid-cols-[minmax(0,1fr)_240px] xl:grid-cols-[minmax(0,1fr)_272px] xl:gap-8">
            <div className="grid min-w-0 gap-7 md:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)]">
              <div>
                <div className="mx-auto max-w-[220px]">
                  <MaterialCover cover={post.cover} />
                </div>
                <SamplePreviewDialog
                  title={post.title}
                  hasSample={post.hasSample}
                  fullWidth
                  className="mt-3"
                />
              </div>

              <div className="min-w-0 py-1">
                <div className="flex flex-wrap gap-2">
                  <Badge className="border-0 bg-[#6950E5]/10 text-[var(--preview-primary)]">
                    {post.year}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-[var(--preview-border)] text-[var(--preview-text)]"
                  >
                    {post.textbook}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-[var(--preview-border)] text-[var(--preview-text)]"
                  >
                    {post.workType}
                  </Badge>
                </div>

                <h1 className="mt-5 break-keep text-3xl font-extrabold leading-tight tracking-[-0.04em] text-[var(--preview-ink)] sm:text-4xl">
                  {post.title}
                </h1>
                <p className="mt-4 max-w-2xl break-keep text-base leading-7 text-[var(--preview-muted)]">
                  {post.summary}
                </p>

                <dl className="mt-6 grid gap-3 border-y border-[var(--preview-border)] py-5 text-sm sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <UserRound
                      aria-hidden="true"
                      className="h-4 w-4 text-[var(--preview-muted)]"
                    />
                    <dt className="sr-only">제작자</dt>
                    <dd className="font-semibold text-[var(--preview-text)]">
                      {post.authorLabel}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarDays
                      aria-hidden="true"
                      className="h-4 w-4 text-[var(--preview-muted)]"
                    />
                    <dt className="sr-only">등록일</dt>
                    <dd>{formatPublishedAt(post.publishedAt)}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <Eye
                      aria-hidden="true"
                      className="h-4 w-4 text-[var(--preview-muted)]"
                    />
                    <dt className="sr-only">조회수</dt>
                    <dd>조회 {post.viewCount.toLocaleString('ko-KR')}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText
                      aria-hidden="true"
                      className="h-4 w-4 text-[var(--preview-muted)]"
                    />
                    <dt className="sr-only">파일 형식</dt>
                    <dd>{post.fileFormats.join(' · ')}</dd>
                  </div>
                </dl>

                <div className="mt-5 flex flex-wrap gap-3">
                  <div className="rounded-md bg-[var(--preview-background)] px-4 py-3">
                    <span className="block text-xs text-[var(--preview-muted)]">
                      수록 지문
                    </span>
                    <strong className="mt-1 block text-lg font-extrabold text-[var(--preview-ink)]">
                      {counts.passageCount}개
                    </strong>
                  </div>
                  <div className="rounded-md bg-[var(--preview-background)] px-4 py-3">
                    <span className="block text-xs text-[var(--preview-muted)]">
                      포함 문항
                    </span>
                    <strong className="mt-1 block text-lg font-extrabold text-[var(--preview-ink)]">
                      {counts.questionCount}개
                    </strong>
                  </div>
                  <div className="rounded-md bg-[var(--preview-background)] px-4 py-3">
                    <span className="block text-xs text-[var(--preview-muted)]">
                      권장 대상
                    </span>
                    <strong className="mt-1 block text-lg font-extrabold text-[var(--preview-ink)]">
                      {post.grade}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <DetailActions
              title={post.title}
              hasSample={post.hasSample}
              questionCount={counts.questionCount}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-2 sm:px-6 lg:px-8">
        <DetailTabs
          questionCount={counts.questionCount}
          information={
            <section
              aria-labelledby="material-information-heading"
              className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
            >
              <div className="rounded-xl border border-[var(--preview-border)] bg-white p-6 sm:p-8">
                <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--preview-primary)]">
                  MATERIAL NOTE
                </span>
                <h2
                  id="material-information-heading"
                  className="mt-2 text-2xl font-extrabold text-[var(--preview-ink)]"
                >
                  수업 흐름이 보이는 자료
                </h2>
                <p className="mt-4 break-keep leading-8 text-[var(--preview-text)]">
                  {post.summary} 한 지문을 A·B·C 세 구간으로 나누고 각 구간과
                  연결된 문항을 함께 살펴볼 수 있도록 구성했습니다.
                </p>
                <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                  {[
                    '구간별 핵심 장면 빠르게 확인',
                    '문항과 지문 참조 관계 표시',
                    '정답과 해설까지 한 화면 구성',
                    'PDF·HWPX 활용 흐름 시안',
                  ].map((item) => (
                    <li
                      key={item}
                      className="flex min-h-11 items-center gap-2 rounded-md bg-[var(--preview-background)] px-3 text-sm font-semibold"
                    >
                      <CheckCircle2
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-[#28947F]"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <aside className="rounded-xl bg-[var(--preview-ink)] p-6 text-white">
                <ShieldCheck
                  aria-hidden="true"
                  className="h-6 w-6 text-[var(--preview-mint)]"
                />
                <h3 className="mt-4 text-lg font-extrabold">
                  합성 콘텐츠 안내
                </h3>
                <p className="mt-3 break-keep text-sm leading-6 text-white/70">
                  화면 구조 검증을 위해 새로 작성한 합성 지문과 문항입니다.
                  실제 작품 원문과 시험 문제를 복제하지 않습니다.
                </p>
              </aside>
            </section>
          }
          passage={
            passage ? (
              <PassageStructure passage={passage} questions={post.questions} />
            ) : null
          }
          questions={<QuestionList questions={post.questions} />}
          sample={
            <section aria-labelledby="sample-preview-heading">
              <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--preview-primary)]">
                    SAMPLE PAGES
                  </span>
                  <h2
                    id="sample-preview-heading"
                    className="mt-2 text-2xl font-extrabold text-[var(--preview-ink)]"
                  >
                    문서 구성 미리보기
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--preview-muted)]">
                    실제 원문이 아닌 합성 문서 3장으로 구성한 시안입니다.
                  </p>
                </div>
                <SamplePreviewDialog
                  title={post.title}
                  hasSample={post.hasSample}
                />
              </div>
              <DocumentPreviewPages />
            </section>
          }
          guide={
            <section
              aria-labelledby="usage-guide-heading"
              className="rounded-xl border border-[var(--preview-border)] bg-white p-6 sm:p-8"
            >
              <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--preview-primary)]">
                USAGE GUIDE
              </span>
              <h2
                id="usage-guide-heading"
                className="mt-2 text-2xl font-extrabold text-[var(--preview-ink)]"
              >
                시안 이용 안내
              </h2>
              <ol className="mt-6 grid gap-4 md:grid-cols-3">
                {[
                  [
                    '01',
                    '구조 확인',
                    '지문 구간과 연결 문항, 정답·해설의 배치를 살펴봅니다.',
                  ],
                  [
                    '02',
                    '샘플 검토',
                    '문서 미리보기에서 자료가 제공될 형태를 확인합니다.',
                  ],
                  [
                    '03',
                    '작업 선택',
                    '문제 생성 또는 라이브러리 저장 흐름의 피드백을 확인합니다.',
                  ],
                ].map(([number, title, description]) => (
                  <li
                    key={number}
                    className="rounded-lg bg-[var(--preview-background)] p-5"
                  >
                    <span className="text-sm font-extrabold text-[var(--preview-primary)]">
                      {number}
                    </span>
                    <strong className="mt-3 block text-base font-extrabold text-[var(--preview-ink)]">
                      {title}
                    </strong>
                    <p className="mt-2 break-keep text-sm leading-6 text-[var(--preview-muted)]">
                      {description}
                    </p>
                  </li>
                ))}
              </ol>
              <Link
                href={boardHref}
                className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--preview-border)] px-4 text-sm font-bold text-[var(--preview-text)] outline-none transition-colors hover:border-[var(--preview-primary)] hover:text-[var(--preview-primary)] focus-visible:ring-2 focus-visible:ring-[var(--preview-primary)] focus-visible:ring-offset-2"
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                {board.title}로 돌아가기
              </Link>
            </section>
          }
        />
      </section>
    </div>
  )
}
