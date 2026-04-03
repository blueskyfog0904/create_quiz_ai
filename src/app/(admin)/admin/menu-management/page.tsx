import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { getMenuManagementData } from './actions'
import MenuManagementClient from './menu-management-client'

interface MenuManagementPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MenuManagementPage({ searchParams }: MenuManagementPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  const data = await getMenuManagementData(workspaceSubject)

  return <MenuManagementClient key={workspaceSubject} {...data} workspaceSubject={workspaceSubject} />
}
