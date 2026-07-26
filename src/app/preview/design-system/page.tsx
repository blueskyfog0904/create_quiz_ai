import type { Metadata } from 'next'
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Search,
  Sparkles,
} from 'lucide-react'

import {
  StudioBoardShell,
  StudioContainer,
  StudioEmptyState,
  StudioFilterPanel,
  StudioPageHeader,
} from '@/components/design-system'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { ShowcaseInteractions } from './showcase-interactions'

export const metadata: Metadata = {
  title: 'Studio Design System',
  description: 'Studio 공통 디자인 토큰과 구성 요소를 확인하는 쇼케이스',
  robots: {
    index: false,
    follow: false,
  },
}

const sectionClassName =
  'min-w-0 scroll-mt-6 space-y-5 border-t border-[var(--studio-border)] pt-10'
const cardClassName =
  'min-w-0 gap-4 rounded-[var(--studio-radius-card)] border-[var(--studio-border)] bg-[var(--studio-surface)] py-5 shadow-[var(--studio-shadow-card)]'

const colorTokens = [
  ['Primary', '--studio-primary'],
  ['Primary soft', '--studio-primary-soft'],
  ['Surface', '--studio-surface'],
  ['Background', '--studio-background'],
  ['Ink', '--studio-ink'],
  ['Muted', '--studio-muted'],
  ['Success', '--studio-success'],
  ['Highlight', '--studio-highlight'],
] as const

const boardRows = [
  {
    title: '2026 수능형 독해 실전 세트',
    subject: '영어',
    level: '중급',
    updatedAt: '오늘',
  },
  {
    title: '문학 작품 핵심 개념 정리',
    subject: '국어',
    level: '기초',
    updatedAt: '어제',
  },
] as const

function SectionHeading({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div>
      <h2 className="text-2xl font-black tracking-[-0.03em] text-[var(--studio-ink)]">
        {title}
      </h2>
      <p className="mt-2 max-w-3xl break-keep text-sm leading-6 text-[var(--studio-muted)]">
        {description}
      </p>
    </div>
  )
}

function MobileBoardCards() {
  return (
    <div className="grid gap-3">
      {boardRows.map((row) => (
        <article
          key={row.title}
          className="min-w-0 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{row.subject}</Badge>
            <span className="text-xs font-semibold text-[var(--studio-muted)]">
              {row.level}
            </span>
          </div>
          <h3 className="mt-3 break-keep font-bold text-[var(--studio-ink)]">
            {row.title}
          </h3>
          <p className="mt-2 text-sm text-[var(--studio-muted)]">
            최근 수정 {row.updatedAt}
          </p>
        </article>
      ))}
    </div>
  )
}

export default function StudioDesignSystemPage() {
  return (
    <div className="studio-theme min-h-screen overflow-x-hidden">
      <StudioPageHeader
        breadcrumbs={
          <>
            <span>Preview</span>
            <span aria-hidden="true">/</span>
            <span className="text-[var(--studio-text)]">Design System</span>
          </>
        }
        eyebrow="LIVING REFERENCE"
        title="Studio Design System"
        description="새 페이지를 만들 때 같은 색상, 타이포그래피, 버튼, 카드와 게시판 구성을 재사용하기 위한 실행 가능한 기준입니다."
        actions={<Button variant="brand">새 페이지 시작</Button>}
      />

      <StudioContainer>
        <div
          data-slot="studio-showcase-content"
          className="min-w-0 space-y-14 py-10 sm:py-14"
        >
          <section className="space-y-5" aria-labelledby="colors-heading">
            <div>
              <h2
                id="colors-heading"
                className="text-2xl font-black tracking-[-0.03em] text-[var(--studio-ink)]"
              >
                Colors
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--studio-muted)]">
                역할을 기준으로 이름 붙인 Studio 토큰입니다. 새 화면은 같은
                역할의 토큰을 재사용합니다.
              </p>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
              {colorTokens.map(([label, token]) => (
                <div
                  key={token}
                  className="min-w-0 overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]"
                >
                  <div
                    aria-hidden="true"
                    className="h-20 border-b border-[var(--studio-border)]"
                    style={{ backgroundColor: `var(${token})` }}
                  />
                  <div className="p-3">
                    <p className="text-sm font-bold text-[var(--studio-ink)]">
                      {label}
                    </p>
                    <code className="mt-1 block break-all text-xs text-[var(--studio-muted)]">
                      {token}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={sectionClassName}>
            <SectionHeading
              title="Typography"
              description="한국어 시스템 폰트와 강한 제목, 읽기 편한 본문 간격을 기준으로 삼습니다."
            />
            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <Card className={cardClassName}>
                <CardContent className="space-y-4 px-5 sm:px-6">
                  <p className="text-4xl font-black tracking-[-0.04em] text-[var(--studio-ink)] sm:text-5xl">
                    학습의 흐름을 선명하게
                  </p>
                  <p className="text-xl font-extrabold text-[var(--studio-ink)]">
                    페이지와 섹션 제목
                  </p>
                  <p className="max-w-2xl break-keep text-sm leading-7 text-[var(--studio-text)]">
                    본문은 작은 화면에서도 자연스럽게 줄바꿈되고, 정보 위계가
                    한 번에 보이도록 충분한 행간을 유지합니다.
                  </p>
                </CardContent>
              </Card>
              <Card className={cardClassName}>
                <CardContent className="space-y-3 px-5 sm:px-6">
                  <p className="text-xs font-extrabold tracking-[0.13em] text-[var(--studio-primary)]">
                    EYEBROW LABEL
                  </p>
                  <p className="text-sm font-semibold text-[var(--studio-text)]">
                    14px · 정보 및 컨트롤 레이블
                  </p>
                  <p className="text-xs text-[var(--studio-muted)]">
                    12px · 메타 정보 및 보조 설명
                  </p>
                </CardContent>
              </Card>
            </div>
          </section>

          <section className={sectionClassName}>
            <SectionHeading
              title="Buttons"
              description="브랜드 행동의 우선순위를 세 가지 additive variant로 표현합니다."
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="brand">Primary action</Button>
              <Button variant="brandOutline">Secondary action</Button>
              <Button variant="brandGhost">Quiet action</Button>
              <Button variant="brand" disabled>
                Disabled
              </Button>
            </div>
          </section>

          <section className={sectionClassName}>
            <SectionHeading
              title="Forms"
              description="레이블, 도움말, disabled 상태와 키보드 focus ring을 함께 확인합니다."
            />
            <StudioFilterPanel
              fields={
                <>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label htmlFor="showcase-search">자료 검색</Label>
                    <Input
                      id="showcase-search"
                      placeholder="제목이나 키워드 입력"
                      className="min-h-11 border-[var(--studio-control-border)] bg-[var(--studio-surface)] focus-visible:border-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]"
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label htmlFor="showcase-disabled">잠긴 필드</Label>
                    <Input
                      id="showcase-disabled"
                      value="수정할 수 없는 값"
                      disabled
                      readOnly
                      className="min-h-11 border-[var(--studio-control-border)] bg-[var(--studio-background)]"
                    />
                  </div>
                  <div className="min-w-0 basis-full space-y-2">
                    <Label htmlFor="showcase-notes">설명</Label>
                    <Textarea
                      id="showcase-notes"
                      placeholder="페이지에서 필요한 설명을 입력하세요"
                      className="min-h-28 border-[var(--studio-control-border)] bg-[var(--studio-surface)] focus-visible:border-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]"
                    />
                  </div>
                </>
              }
              activeFilters={
                <Button type="button" variant="brandGhost">
                  영어 ×
                </Button>
              }
              actions={
                <Button type="button" variant="brand">
                  <Search aria-hidden="true" />
                  검색
                </Button>
              }
            />
          </section>

          <section className={sectionClassName}>
            <SectionHeading
              title="Cards"
              description="동일한 radius, border, surface와 shadow를 사용하는 정보 카드입니다."
            />
            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {['영어 독해', '국어 문학', '시험지 구성'].map((title, index) => (
                <Card key={title} className={cardClassName}>
                  <CardHeader className="px-5 sm:px-6">
                    <div className="flex size-11 items-center justify-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
                      <FileText aria-hidden="true" className="size-5" />
                    </div>
                    <CardTitle className="mt-2 text-lg font-extrabold text-[var(--studio-ink)]">
                      {title}
                    </CardTitle>
                    <CardDescription className="leading-6 text-[var(--studio-muted)]">
                      핵심 정보와 다음 행동이 분명한 공통 카드 예시입니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-5 text-sm text-[var(--studio-text)] sm:px-6">
                    최근 자료 {index + 3}개
                  </CardContent>
                  <CardFooter className="px-5 sm:px-6">
                    <Button variant="brandGhost">자세히 보기</Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </section>

          <section className={sectionClassName}>
            <SectionHeading
              title="Board"
              description="데스크톱 표와 모바일 카드가 같은 정보와 상호작용 상태를 공유합니다."
            />
            <StudioBoardShell
              summary={
                <p className="font-bold text-[var(--studio-ink)]">
                  전체 <span className="text-[var(--studio-primary)]">2</span>개
                </p>
              }
              toolbar={<Button variant="brandOutline">최신순</Button>}
              desktopResults={
                <div className="overflow-x-auto rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
                  <table className="w-full min-w-[42rem] text-left text-sm">
                    <thead className="bg-[var(--studio-primary-soft)] text-[var(--studio-ink)]">
                      <tr>
                        <th className="px-5 py-4 font-extrabold">자료명</th>
                        <th className="px-5 py-4 font-extrabold">과목</th>
                        <th className="px-5 py-4 font-extrabold">난이도</th>
                        <th className="px-5 py-4 font-extrabold">수정일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {boardRows.map((row) => (
                        <tr
                          key={row.title}
                          className="border-t border-[var(--studio-border)]"
                        >
                          <td className="px-5 py-4 font-bold text-[var(--studio-ink)]">
                            {row.title}
                          </td>
                          <td className="px-5 py-4">{row.subject}</td>
                          <td className="px-5 py-4">{row.level}</td>
                          <td className="px-5 py-4 text-[var(--studio-muted)]">
                            {row.updatedAt}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
              mobileResults={<MobileBoardCards />}
            />
          </section>

          <section className={sectionClassName}>
            <SectionHeading
              title="States"
              description="비어 있음, 로딩, 오류, 성공 상태를 같은 시각 언어로 제공합니다."
            />
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <StudioEmptyState
                icon={<FileText aria-hidden="true" className="size-6" />}
                title="아직 자료가 없습니다"
                description="첫 자료를 추가하면 이 영역에서 바로 확인할 수 있습니다."
                action={<Button variant="brand">자료 추가</Button>}
              />
              <Card className={cardClassName}>
                <CardHeader className="px-5 sm:px-6">
                  <CardTitle className="text-lg font-extrabold text-[var(--studio-ink)]">
                    Loading
                  </CardTitle>
                  <CardDescription>자료를 불러오고 있습니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 px-5 sm:px-6">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--studio-primary-soft)] motion-reduce:animate-none" />
                  <div className="h-4 w-full animate-pulse rounded bg-[var(--studio-primary-soft)] motion-reduce:animate-none" />
                  <span className="sr-only">로딩 중</span>
                </CardContent>
              </Card>
              <Card className={cardClassName}>
                <CardHeader className="px-5 sm:px-6">
                  <AlertCircle
                    aria-hidden="true"
                    className="size-6 text-[var(--studio-highlight)]"
                  />
                  <CardTitle className="text-lg font-extrabold text-[var(--studio-ink)]">
                    Error
                  </CardTitle>
                  <CardDescription>
                    요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.
                  </CardDescription>
                </CardHeader>
                <CardFooter className="px-5 sm:px-6">
                  <Button variant="brandOutline">다시 시도</Button>
                </CardFooter>
              </Card>
              <Card className={cardClassName}>
                <CardHeader className="px-5 sm:px-6">
                  <CheckCircle2
                    aria-hidden="true"
                    className="size-6 text-[var(--studio-success)]"
                  />
                  <CardTitle className="text-lg font-extrabold text-[var(--studio-ink)]">
                    Success
                  </CardTitle>
                  <CardDescription>
                    변경 사항이 안전하게 저장되었습니다.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-5 sm:px-6">
                  <Badge className="bg-[var(--studio-success)] text-[var(--studio-ink)]">
                    <Sparkles aria-hidden="true" /> 완료
                  </Badge>
                </CardContent>
              </Card>
            </div>
          </section>

          <ShowcaseInteractions />
        </div>
      </StudioContainer>
    </div>
  )
}
