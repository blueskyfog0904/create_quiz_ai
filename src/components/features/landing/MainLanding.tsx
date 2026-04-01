import Link from 'next/link'
import { Button } from '@/components/ui/button'

const workspaceCards = [
  {
    subject: 'english',
    label: 'English Workspace',
    title: '영어 들어가기',
    description: '문제생성, 문제은행, 라이브러리, 문제지 제작까지 영어 서비스 전체를 이용합니다.',
    buttonLabel: '영어 서비스 열기',
    buttonVariant: 'default' as const,
  },
  {
    subject: 'korean',
    label: 'Korean Workspace',
    title: '국어 들어가기',
    description: '국어 워크스페이스에서 문제마켓과 라이브러리, 문제지 제작 흐름을 이용합니다.',
    buttonLabel: '국어 서비스 열기',
    buttonVariant: 'outline' as const,
  },
]

export function MainLanding() {
  return (
    <div className="bg-gray-50">
      <section className="container mx-auto px-4 py-20 text-center">
        <div className="mx-auto max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.25em] text-primary">
            SummerSun Lab
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 md:text-6xl word-keep-all">
            써머썬 연구소
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-gray-600 md:text-xl word-keep-all">
            영어와 국어 워크스페이스를 선택해서
            필요한 서비스로 빠르게 이동하세요.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl gap-6 text-left md:grid-cols-2">
          {workspaceCards.map((card) => (
            <Link
              key={card.subject}
              href={`/${card.subject}`}
              className="group rounded-3xl border border-gray-200 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <div className="mb-4 text-sm font-semibold text-primary">
                {card.label}
              </div>
              <h2 className="text-3xl font-bold text-gray-900">
                {card.title}
              </h2>
              <p className="mt-3 min-h-16 text-base leading-7 text-gray-600 word-keep-all">
                {card.description}
              </p>
              <div className="mt-8">
                <Button size="lg" variant={card.buttonVariant}>
                  {card.buttonLabel}
                </Button>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
