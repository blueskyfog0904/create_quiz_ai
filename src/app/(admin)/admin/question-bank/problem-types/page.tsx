import type { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import QuestionBankProblemTypesClient from './question-bank-problem-types-client'

export const metadata: Metadata = {
  title: '문제은행 문제유형 설정 | 관리자 패널',
  description: '문제은행에서 사용할 문제유형 옵션을 관리합니다.',
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
          <h2 className="text-3xl font-bold tracking-tight">문제은행 문제유형 설정</h2>
          <p className="text-sm text-muted-foreground">
            {workspaceSubject === 'english' ? '영어' : '국어'} 문제은행의 분류용 문제유형을 관리합니다.
          </p>
        </div>
      </div>
      <QuestionBankProblemTypesClient workspaceSubject={workspaceSubject} />
    </div>
  )
}
