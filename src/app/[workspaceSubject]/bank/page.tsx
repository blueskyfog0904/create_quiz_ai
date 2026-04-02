import BankPage from '@/app/(dashboard)/bank/page'
import { resolveWorkspaceRouteParams, withWorkspaceSubjectSearchParams } from '@/app/subject-route-helpers'

interface WorkspaceBankPageProps {
  params: Promise<{ workspaceSubject: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function WorkspaceBankPage({ params, searchParams }: WorkspaceBankPageProps) {
  const { workspaceSubject } = await resolveWorkspaceRouteParams(params)

  return (
    <BankPage
      searchParams={withWorkspaceSubjectSearchParams(workspaceSubject, searchParams)}
    />
  )
}
