import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/auth'
import MultiGenerateClient from '../multi/multi-generate-client'
import { resolveGenerateWorkspaceSubject } from '../workspace-subject'

interface PersonalGeneratePageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function PersonalGeneratePage({ searchParams }: PersonalGeneratePageProps) {
  const supabase = await createClient()
  const { user } = await getUser()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveGenerateWorkspaceSubject({
    workspaceSubject: resolvedSearchParams?.subject,
  })

  const { data: problemTypes } = await supabase
    .from('problem_types')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .eq('is_active', true)
    .neq('model_name', 'admin')
    .order('type_name')

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">개인지문</h1>
        <p className="text-gray-500">
          하나의 지문으로 여러 문제 유형을 동시에 생성하세요.
        </p>
      </div>

      <MultiGenerateClient
        problemTypes={problemTypes || []}
        workspaceSubject={workspaceSubject}
        isLoggedIn={Boolean(user)}
      />
    </div>
  )
}
