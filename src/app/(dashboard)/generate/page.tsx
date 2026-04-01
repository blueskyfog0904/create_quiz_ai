import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import GenerateHomeContent from './generate-home-content'
import { resolveGenerateWorkspaceSubject } from './workspace-subject'

interface GeneratePageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function GeneratePage({ searchParams }: GeneratePageProps) {
  await requireAuth()
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveGenerateWorkspaceSubject({
    workspaceSubject: resolvedSearchParams?.subject,
  })

  const { data: problemTypes } = await supabase
    .from('problem_types')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .eq('is_active', true)
    .neq('model_name', 'admin')  // Admin 문제 유형은 AI 생성에서 제외
    .order('type_name')

  return <GenerateHomeContent problemTypes={problemTypes || []} />
}
