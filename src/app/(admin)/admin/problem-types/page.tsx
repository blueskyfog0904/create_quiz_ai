import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import ProblemTypesClient from './problem-types-client'
import { redirect } from 'next/navigation'

interface ProblemTypesPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function ProblemTypesPage({ searchParams }: ProblemTypesPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  
  // Check authentication and admin status
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    // Redirect to home or show unauthorized
    redirect('/')
    // Alternatively, return an unauthorized UI
    // return <div>Unauthorized Access</div>
  }

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
      <h1 className="text-3xl font-bold mb-6">문제 유형 관리 · {workspaceSubject === 'english' ? '영어' : '국어'}</h1>
      <ProblemTypesClient
        initialTypes={types || []}
        initialModels={aiModels || []}
        initialDefaultPrompts={defaultPrompts || []}
        workspaceSubject={workspaceSubject}
      />
    </div>
  )
}
