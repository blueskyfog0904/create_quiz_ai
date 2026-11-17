import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import ProblemTypeFormClient from './problem-type-form-client'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function EditProblemTypePage({ params, searchParams }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  
  // Check authentication and admin status
  // 꺼 둔 기능의 화면이다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 본다.
  await requireAdminPagePermission('owner')

  // Fetch problem type
  const { data: problemType } = await supabase
    .from('problem_types')
    .select('*')
    .eq('id', id)
    .eq('workspace_subject', workspaceSubject)
    .single()

  if (!problemType) {
    redirect(`/admin/problem-types?subject=${workspaceSubject}`)
  }

  const { data: defaultPrompts } = await supabase
    .from('problem_type_default_prompts')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .order('sort_order', { ascending: true })

  return (
    <div className="container mx-auto py-8">
      <ProblemTypeFormClient
        problemType={problemType}
        workspaceSubject={workspaceSubject}
        defaultPrompts={defaultPrompts || []}
      />
    </div>
  )
}
