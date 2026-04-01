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

  return (
    <div className="container mx-auto py-8">
      <ProblemTypeFormClient problemType={problemType} workspaceSubject={workspaceSubject} />
    </div>
  )
}
