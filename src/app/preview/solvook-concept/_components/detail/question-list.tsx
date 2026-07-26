import { Badge } from '@/components/ui/badge'
import type { SampleQuestion } from '../../_data/sample-data'

interface QuestionListProps {
  questions: SampleQuestion[]
}

export function QuestionList({ questions }: QuestionListProps) {
  return (
    <section aria-labelledby="question-list-heading">
      <div className="mb-6">
        <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--studio-primary)]">
          QUESTION SET
        </span>
        <h2
          id="question-list-heading"
          className="mt-2 text-2xl font-extrabold tracking-[-0.025em] text-[var(--studio-ink)]"
        >
          포함 문항 {questions.length}개
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">
          문항 유형과 연결 구간, 정답 및 해설 구성을 한 번에 확인할 수
          있습니다.
        </p>
      </div>

      <div className="space-y-4">
        {questions.map((question, index) => (
          <article
            key={question.id}
            id={`question-${question.id}`}
            className="scroll-mt-40 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 sm:p-7"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid h-8 min-w-8 place-items-center rounded-md bg-[var(--studio-ink)] px-2 text-sm font-extrabold text-white">
                {index + 1}
              </span>
              <Badge
                variant="outline"
                className="border-[var(--studio-primary-border)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]"
              >
                {question.type}
              </Badge>
              {question.segmentRefs.map((segment) => (
                <Badge
                  key={segment}
                  variant="outline"
                  className="border-[var(--studio-border)] text-[var(--studio-muted)]"
                >
                  [{segment}]
                </Badge>
              ))}
            </div>

            <h3 className="mt-5 break-keep text-base font-extrabold leading-7 text-[var(--studio-ink)] sm:text-lg">
              {question.prompt}
            </h3>

            <ol className="mt-4 grid gap-2 sm:grid-cols-2">
              {question.choices.map((choice, choiceIndex) => (
                <li
                  key={`${question.id}-${choiceIndex}`}
                  className="flex min-h-11 items-start gap-2 rounded-md bg-[var(--studio-background)] px-3 py-2.5 text-sm leading-6 text-[var(--studio-text)]"
                >
                  <span
                    aria-hidden="true"
                    className="font-bold text-[var(--studio-muted)]"
                  >
                    {['①', '②', '③', '④', '⑤'][choiceIndex] ??
                      `${choiceIndex + 1}.`}
                  </span>
                  <span>{choice}</span>
                </li>
              ))}
            </ol>

            <div className="mt-5 grid gap-3 rounded-lg border border-[var(--studio-success)] bg-[var(--studio-surface)] p-4 sm:grid-cols-[80px_minmax(0,1fr)]">
              <strong className="text-sm font-extrabold text-[var(--studio-ink)]">
                정답 {question.answer}
              </strong>
              <p className="text-sm leading-6 text-[var(--studio-text)]">
                <span className="mr-2 font-extrabold text-[var(--studio-ink)]">
                  해설
                </span>
                {question.explanation}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
