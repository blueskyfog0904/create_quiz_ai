import Link from 'next/link'
import {
  BookOpenCheck,
  BookOpenText,
  FileCheck2,
  FileSearch,
  FolderKanban,
  GraduationCap,
  LibraryBig,
  Sparkles,
} from 'lucide-react'

const previewRoot = '/preview/solvook-concept'
const boardHref = `${previewRoot}/boards/ebs-literature`
const detailHref = `${boardHref}/posts/jingsori-2027`

const quickAccessItems = [
  {
    label: '국어 AI 생성',
    href: detailHref,
    icon: Sparkles,
    tone: 'bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]',
  },
  {
    label: '영어 AI 생성',
    href: `${previewRoot}?subject=english`,
    icon: GraduationCap,
    tone: 'bg-[#4879E8]/10 text-[#3E6ED8]',
  },
  {
    label: 'EBS 자료',
    href: `${boardHref}?textbook=EBS+수능특강`,
    icon: BookOpenText,
    tone: 'bg-[var(--studio-success)]/20 text-[#268978]',
  },
  {
    label: '모의고사',
    href: `${boardHref}?view=mock-exam`,
    icon: FileCheck2,
    tone: 'bg-[var(--studio-highlight)]/10 text-[#D95044]',
  },
  {
    label: '교과서',
    href: `${boardHref}?textbook=교과서+문학`,
    icon: BookOpenCheck,
    tone: 'bg-[#F0B64C]/15 text-[#AD7510]',
  },
  {
    label: '문제은행',
    href: `${boardHref}?view=question-bank`,
    icon: FolderKanban,
    tone: 'bg-[#7B61B8]/10 text-[#6C50AD]',
  },
  {
    label: '시험지 제작',
    href: `${boardHref}?view=exam-builder`,
    icon: FileSearch,
    tone: 'bg-[#32A1C4]/10 text-[#237E9B]',
  },
  {
    label: '내 라이브러리',
    href: `${boardHref}?view=library`,
    icon: LibraryBig,
    tone: 'bg-[#344563]/10 text-[#344563]',
  },
] as const

export function QuickAccessGrid() {
  return (
    <section
      aria-labelledby="quick-access-title"
    >
      <h2 id="quick-access-title" className="sr-only">
        빠른 메뉴
      </h2>
      <div className="grid grid-cols-4 gap-2 sm:gap-3 lg:grid-cols-8">
        {quickAccessItems.map((item) => {
          const Icon = item.icon

          return (
            <Link
              key={item.label}
              href={item.href}
              className="group flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-1.5 py-3 text-center outline-none transition hover:-translate-y-0.5 hover:border-[var(--studio-primary-border)] hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] sm:min-h-[116px]"
            >
              <span
                className={`grid h-11 w-11 place-items-center rounded-xl transition-transform group-hover:scale-105 sm:h-12 sm:w-12 ${item.tone}`}
              >
                <Icon aria-hidden="true" className="h-5 w-5 sm:h-6 sm:w-6" />
              </span>
              <span className="break-keep text-[11px] font-bold leading-4 text-[var(--studio-text)] sm:text-xs">
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
