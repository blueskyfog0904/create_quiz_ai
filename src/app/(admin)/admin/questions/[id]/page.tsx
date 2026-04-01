import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { EditQuestionClient } from './edit-question-client'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function EditQuestionPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div>
      <EditQuestionClient questionId={id} workspaceSubject={workspaceSubject} />
    </div>
  )
}

