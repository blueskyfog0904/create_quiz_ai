import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import AdminUploadClient from './admin-upload-client'

interface AdminUploadPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function AdminUploadPage({ searchParams }: AdminUploadPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  
  // Fetch all active question-bank problem types
  const { data: problemTypes } = await supabase
    .from('question_bank_problem_types')
    .select('*')
    .eq('is_active', true)
    .eq('workspace_subject', workspaceSubject)
    .order('type_name')
  
  // Define grade levels and difficulties
  const gradeLevels = ['중1', '중2', '중3', '고1', '고2', '고3']
  const difficulties = ['하', '중', '상']
  
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">문제 업로드 · {workspaceSubject === 'english' ? '영어' : '국어'}</h1>
        <p className="text-gray-500 mt-1">선택한 과목의 문제를 업로드하고 관리합니다</p>
      </div>
      
      <AdminUploadClient 
        problemTypes={problemTypes || []} 
        gradeLevels={gradeLevels}
        difficulties={difficulties}
        workspaceSubject={workspaceSubject}
      />
    </div>
  )
}

