import { FileText } from 'lucide-react'

const previewPages = [
  {
    label: '지문 구조',
    title: '구간 표시가 있는 문학 지문',
    accent: 'bg-[var(--studio-primary)]',
    lines: ['w-full', 'w-[92%]', 'w-[96%]', 'w-[82%]', 'w-[90%]'],
  },
  {
    label: '문항 구성',
    title: '연결 문항과 선택지',
    accent: 'bg-[var(--studio-success)]',
    lines: ['w-[88%]', 'w-full', 'w-[94%]', 'w-[76%]', 'w-[90%]'],
  },
  {
    label: '정답·해설',
    title: '수업용 해설 노트',
    accent: 'bg-[var(--studio-highlight)]',
    lines: ['w-full', 'w-[84%]', 'w-[92%]', 'w-[80%]', 'w-[72%]'],
  },
] as const

export function DocumentPreviewPages() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {previewPages.map((page, index) => (
        <article
          key={page.label}
          className="aspect-[4/5] rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4 shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-[var(--studio-border)] pb-3">
            <span className="text-[11px] font-extrabold tracking-[0.08em] text-[var(--studio-muted)]">
              PAGE {index + 1}
            </span>
            <FileText
              aria-hidden="true"
              className="h-4 w-4 text-[var(--studio-primary)]"
            />
          </div>
          <div className="pt-5">
            <span
              className={`mb-3 block h-1 w-8 rounded-full ${page.accent}`}
            />
            <strong className="block break-keep text-sm font-extrabold text-[var(--studio-ink)]">
              {page.title}
            </strong>
            <span className="mt-1 block text-xs font-semibold text-[var(--studio-muted)]">
              {page.label}
            </span>
            <div className="mt-6 space-y-3" aria-hidden="true">
              {page.lines.map((width, lineIndex) => (
                <span
                  key={`${page.label}-${lineIndex}`}
                  className={`block h-1.5 rounded-full bg-[var(--studio-border)] ${width}`}
                />
              ))}
            </div>
            <div className="mt-6 rounded-md bg-[var(--studio-background)] p-3">
              <span className="block h-1.5 w-12 rounded-full bg-[var(--studio-control-border)]" />
              <span className="mt-2 block h-1.5 w-full rounded-full bg-[var(--studio-border)]" />
              <span className="mt-2 block h-1.5 w-[78%] rounded-full bg-[var(--studio-border)]" />
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
