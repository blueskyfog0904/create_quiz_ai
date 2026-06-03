import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import ProblemTypeFormClient from './problem-type-form-client'

interface NewProblemTypePageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function NewProblemTypePage({ searchParams }: NewProblemTypePageProps) {
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
    redirect('/')
  }

  const { data: defaultPrompts } = await supabase
    .from('problem_type_default_prompts')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .order('sort_order', { ascending: true })

  return (
    <div className="container mx-auto py-8">
      <ProblemTypeFormClient workspaceSubject={workspaceSubject} defaultPrompts={defaultPrompts || []} />
    </div>
  )
}
