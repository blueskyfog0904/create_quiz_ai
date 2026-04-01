import { Metadata } from 'next'
import SourceConfigClient from './source-config-client'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'

export const metadata: Metadata = {
  title: '출처 관리 | 관리자 패널',
  description: '문제 출처 및 필드 설정을 관리합니다.',
}

interface SourceConfigPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function SourceConfigPage({ searchParams }: SourceConfigPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">출처 관리 · {workspaceSubject === 'english' ? '영어' : '국어'}</h2>
      </div>
      <SourceConfigClient workspaceSubject={workspaceSubject} />
    </div>
  )
}
