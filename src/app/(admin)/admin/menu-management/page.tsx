import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { getMenuManagementData } from './actions'
import MenuManagementClient from './menu-management-client'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

interface MenuManagementPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MenuManagementPage({ searchParams }: MenuManagementPageProps) {
  // 메뉴관리는 닫을 예정인 화면이라(계획 4-2절 2차) 그 전까지 대표 관리자만 본다.
  await requireAdminPagePermission('owner')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  const data = await getMenuManagementData(workspaceSubject)

  return <MenuManagementClient key={workspaceSubject} {...data} workspaceSubject={workspaceSubject} />
}
