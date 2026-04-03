import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/auth'
import GenerateClient from './generate-client'
import { Button } from '@/components/ui/button'
import GenerateHomeContent from '../generate-home-content'
import { resolveGenerateWorkspaceSubject } from '../workspace-subject'
import { WorkspaceLink } from '@/components/layout/workspace-link'

interface GenerateWithTypePageProps {
  params: Promise<{ typeId: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function GenerateWithTypePage({ params, searchParams }: GenerateWithTypePageProps) {
  const supabase = await createClient()
  const { user } = await getUser()
  const { typeId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveGenerateWorkspaceSubject({
    workspaceSubject: resolvedSearchParams?.subject,
  })

  // Fetch the specific problem type
  const { data: problemType, error } = await supabase
    .from('problem_types')
    .select('*')
    .eq('id', typeId)
    .eq('workspace_subject', workspaceSubject)
    .eq('is_active', true)
    .single()

  if (error || !problemType) {
    const { data: problemTypes } = await supabase
      .from('problem_types')
      .select('*')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .neq('model_name', 'admin')
      .order('type_name')

    return <GenerateHomeContent problemTypes={problemTypes || []} />
  }

  return (
    <div>
      <WorkspaceLink href="/generate">
        <Button variant="ghost" className="mb-4">← 문제 유형 선택으로</Button>
      </WorkspaceLink>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold">{problemType.type_name}</h1>

        </div>
        {problemType.description && (
          <p className="text-gray-600">{problemType.description}</p>
        )}
      </div>
      
      <GenerateClient
        problemType={problemType}
        workspaceSubject={workspaceSubject}
        isLoggedIn={Boolean(user)}
      />
    </div>
  )
}
