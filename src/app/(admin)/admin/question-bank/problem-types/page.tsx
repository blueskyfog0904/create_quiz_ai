import type { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import QuestionBankProblemTypesClient from './question-bank-problem-types-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/question-bank/problem-types',
    fallbackName: '문제은행 문제유형 설정',
    searchParams,
    description: '문제은행에서 사용할 문제유형 옵션을 관리합니다.',
  })
}

interface QuestionBankProblemTypesPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function QuestionBankProblemTypesPage({ searchParams }: QuestionBankProblemTypesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight"><AdminMenuName href="/admin/question-bank/problem-types" fallback="문제은행 문제유형 설정" /></h2>
          <p className="text-sm text-muted-foreground">
            {workspaceSubject === 'english' ? '영어' : '국어'} 문제은행의 분류용 문제유형을 관리합니다.
          </p>
        </div>
      </div>
      <QuestionBankProblemTypesClient workspaceSubject={workspaceSubject} />
    </div>
  )
}
