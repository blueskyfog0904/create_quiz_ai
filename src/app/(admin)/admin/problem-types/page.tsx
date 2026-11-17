import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import ProblemTypesClient from './problem-types-client'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'

interface ProblemTypesPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function ProblemTypesPage({ searchParams }: ProblemTypesPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  
  // Check authentication and admin status
  // 꺼 둔 기능의 화면이다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 본다.
  await requireAdminPagePermission('owner')

  const { data: types } = await supabase
    .from('problem_types')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })

  const { data: aiModels } = await supabase
    .from('ai_models')
    .select('*')
    .order('display_order', { ascending: true })

  const { data: defaultPrompts } = await supabase
    .from('problem_type_default_prompts')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .order('sort_order', { ascending: true })

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6"><AdminMenuName href="/admin/problem-types" fallback="문제 유형 관리" /> · {workspaceSubject === 'english' ? '영어' : '국어'}</h1>
      <ProblemTypesClient
        initialTypes={types || []}
        initialModels={aiModels || []}
        initialDefaultPrompts={defaultPrompts || []}
        workspaceSubject={workspaceSubject}
      />
    </div>
  )
}
