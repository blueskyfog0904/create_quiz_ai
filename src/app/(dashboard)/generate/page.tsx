import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import GenerateHomeContent from './generate-home-content'
import { DEFAULT_GENERATE_WORKSPACE_SUBJECT } from './workspace-subject'

export default async function GeneratePage() {
  await requireAuth()
  const supabase = await createClient()
  const workspaceSubject = DEFAULT_GENERATE_WORKSPACE_SUBJECT

  const { data: problemTypes } = await supabase
    .from('problem_types')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .eq('is_active', true)
    .neq('model_name', 'admin')  // Admin 문제 유형은 AI 생성에서 제외
    .order('type_name')

  return <GenerateHomeContent problemTypes={problemTypes || []} />
}
