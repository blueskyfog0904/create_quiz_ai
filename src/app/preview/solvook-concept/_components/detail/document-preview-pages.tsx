import { FileText } from 'lucide-react'

const previewPages = [
  {
    label: '지문 구조',
    title: '구간 표시가 있는 문학 지문',
    accent: 'bg-[#6950E5]',
    lines: ['w-full', 'w-[92%]', 'w-[96%]', 'w-[82%]', 'w-[90%]'],
  },
  {
    label: '문항 구성',
    title: '연결 문항과 선택지',
    accent: 'bg-[#63CDB7]',
    lines: ['w-[88%]', 'w-full', 'w-[94%]', 'w-[76%]', 'w-[90%]'],
  },
  {
    label: '정답·해설',
    title: '수업용 해설 노트',
    accent: 'bg-[#F46D5E]',
    lines: ['w-full', 'w-[84%]', 'w-[92%]', 'w-[80%]', 'w-[72%]'],
  },
] as const

export function DocumentPreviewPages() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {previewPages.map((page, index) => (
        <article
          key={page.label}
          className="aspect-[4/5] rounded-lg border border-[var(--preview-border)] bg-white p-4 shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-[var(--preview-border)] pb-3">
            <span className="text-[11px] font-extrabold tracking-[0.08em] text-[var(--preview-muted)]">
              PAGE {index + 1}
            </span>
            <FileText
              aria-hidden="true"
              className="h-4 w-4 text-[var(--preview-primary)]"
            />
          </div>
          <div className="pt-5">
            <span
              className={`mb-3 block h-1 w-8 rounded-full ${page.accent}`}
            />
            <strong className="block break-keep text-sm font-extrabold text-[var(--preview-ink)]">
              {page.title}
            </strong>
            <span className="mt-1 block text-xs font-semibold text-[var(--preview-muted)]">
              {page.label}
            </span>
            <div className="mt-6 space-y-3" aria-hidden="true">
              {page.lines.map((width, lineIndex) => (
                <span
                  key={`${page.label}-${lineIndex}`}
                  className={`block h-1.5 rounded-full bg-[#E9EAF0] ${width}`}
                />
              ))}
            </div>
            <div className="mt-6 rounded-md bg-[var(--preview-background)] p-3">
              <span className="block h-1.5 w-12 rounded-full bg-[#CFD2DD]" />
              <span className="mt-2 block h-1.5 w-full rounded-full bg-[#DEE0E7]" />
              <span className="mt-2 block h-1.5 w-[78%] rounded-full bg-[#DEE0E7]" />
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
