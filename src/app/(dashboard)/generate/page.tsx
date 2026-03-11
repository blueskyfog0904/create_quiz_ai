import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import GenerateHomeContent from './generate-home-content'

export default async function GeneratePage() {
  await requireAuth()
  const supabase = await createClient()

  const { data: problemTypes } = await supabase
    .from('problem_types')
    .select('*')
    .eq('is_active', true)
    .neq('model_name', 'admin')  // Admin 문제 유형은 AI 생성에서 제외
    .order('type_name')

  return <GenerateHomeContent problemTypes={problemTypes || []} />
}
