import { BookOpenText, Link2 } from 'lucide-react'
import type {
  SamplePassage,
  SampleQuestion,
} from '../../_data/sample-data'

interface PassageStructureProps {
  passage: SamplePassage
  questions: SampleQuestion[]
}

export function PassageStructure({
  passage,
  questions,
}: PassageStructureProps) {
  return (
    <section aria-labelledby="passage-structure-heading">
      <div className="mb-6">
        <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--studio-primary)]">
          PASSAGE MAP
        </span>
        <h2
          id="passage-structure-heading"
          className="mt-2 text-2xl font-extrabold tracking-[-0.025em] text-[var(--studio-ink)]"
        >
          {passage.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">
          {passage.sourceNote}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[132px_minmax(0,1fr)]">
        <nav
          aria-label="지문 구간 바로가기"
          className="md:sticky md:top-[148px] md:self-start"
        >
          <p className="mb-2 text-xs font-bold text-[var(--studio-muted)]">
            구간 바로가기
          </p>
          <div className="relative flex gap-2 overflow-x-auto pb-1 md:flex-col md:gap-1 md:overflow-visible md:pb-0 md:pl-4">
            <span
              aria-hidden="true"
              className="absolute bottom-5 left-[31px] top-5 hidden w-px bg-[var(--studio-border)] md:block"
            />
            {passage.segments.map((segment) => (
              <a
                key={segment.label}
                href={`#segment-${passage.id}-${segment.label}`}
                className="relative z-10 inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-[var(--studio-border)] bg-[var(--studio-surface)] px-3 text-sm font-extrabold text-[var(--studio-text)] outline-none transition-colors hover:border-[var(--studio-primary)] hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] focus-visible:ring-offset-2 md:border-0 md:bg-transparent md:px-0"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]">
                  {segment.label}
                </span>
                <span className="md:sr-only">{segment.title}</span>
              </a>
            ))}
          </div>
        </nav>

        <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
          <div className="flex items-center gap-3 border-b border-[var(--studio-border)] bg-[var(--studio-background)] px-5 py-4 sm:px-7">
            <BookOpenText
              aria-hidden="true"
              className="h-5 w-5 text-[var(--studio-primary)]"
            />
            <div>
              <strong className="block text-sm font-extrabold text-[var(--studio-ink)]">
                합성 문학 지문
              </strong>
              <span className="text-xs text-[var(--studio-muted)]">
                A·B·C 구간과 연결 문항을 함께 확인하세요.
              </span>
            </div>
          </div>

          <div className="px-5 py-2 sm:px-8">
            {passage.segments.map((segment) => {
              const linkedQuestions = questions.filter((question) =>
                question.segmentRefs.includes(segment.label)
              )

              return (
                <section
                  key={segment.label}
                  id={`segment-${passage.id}-${segment.label}`}
                  className="scroll-mt-40 border-b border-[var(--studio-border)] py-8 last:border-b-0"
                >
                  <div className="mb-5 flex flex-wrap items-center gap-2">
                    <span className="inline-flex min-h-8 items-center rounded-md bg-[var(--studio-primary)] px-3 text-sm font-extrabold text-white">
                      [{segment.label}]
                    </span>
                    <h3 className="text-lg font-extrabold text-[var(--studio-ink)]">
                      {segment.title}
                    </h3>
                  </div>
                  <div className="space-y-5">
                    {segment.content.map((paragraph, index) => (
                      <p
                        key={`${segment.label}-${index}`}
                        className="break-keep text-[15px] leading-8 text-[var(--studio-text)] sm:text-base"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  <div className="mt-6 flex flex-wrap items-center gap-2">
                    <Link2
                      aria-hidden="true"
                      className="h-4 w-4 text-[var(--studio-muted)]"
                    />
                    <span className="text-xs font-bold text-[var(--studio-muted)]">
                      연결 문항
                    </span>
                    {linkedQuestions.map((question) => (
                      <span
                        key={question.id}
                        className="inline-flex min-h-8 items-center rounded-full border border-[var(--studio-border)] px-2.5 text-xs font-extrabold text-[var(--studio-primary)]"
                      >
                        {questions.indexOf(question) + 1}번
                      </span>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
