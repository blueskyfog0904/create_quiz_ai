import type { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import QuestionBankBackfillClient from './question-bank-backfill-client'

export const metadata: Metadata = {
  title: '문제은행 백필 | 관리자 패널',
  description: '기존 관리자 원본과 저장본의 문제은행 메타데이터를 감사하고 백필합니다.',
}

interface QuestionBankBackfillPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function QuestionBankBackfillPage({ searchParams }: QuestionBankBackfillPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">문제은행 백필</h2>
          <p className="text-sm text-muted-foreground">
            {workspaceSubject === 'english' ? '영어' : '국어'} 기존 데이터의 연도/교재 메타데이터 누락과 저장본 패리티를 점검합니다.
          </p>
        </div>
      </div>
      <QuestionBankBackfillClient workspaceSubject={workspaceSubject} />
    </div>
  )
}
