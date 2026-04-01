import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { QuestionsClient } from './questions-client'

interface AdminQuestionsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function AdminQuestionsPage({ searchParams }: AdminQuestionsPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  // Fetch problem types for filter
  const { data: problemTypes } = await supabase
    .from('problem_types')
    .select('id, type_name')
    .eq('is_active', true)
    .eq('workspace_subject', workspaceSubject)
    .order('type_name')

  const gradeLevels = ['중1', '중2', '중3', '고1', '고2', '고3']
  const difficulties = ['하', '중', '상']

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">문제은행 관리 · {workspaceSubject === 'english' ? '영어' : '국어'}</h1>
        <p className="text-gray-500 mt-1">업로드된 문제를 과목별로 조회하고 관리합니다</p>
      </div>

      <QuestionsClient
        problemTypes={problemTypes || []}
        gradeLevels={gradeLevels}
        difficulties={difficulties}
        workspaceSubject={workspaceSubject}
      />
    </div>
  )
}

