import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  listGenerateListboardPostsForAdmin,
  listGenerateMenuEntriesForAdmin,
} from '@/lib/generate-menu-server'
import GenerateProductsClient from './generate-products-client'

interface GenerateProductsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function GenerateProductsPage({ searchParams }: GenerateProductsPageProps) {
  // 꺼 둔 기능의 화면이다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 본다.
  await requireAdminPagePermission('owner')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  const generateMenuEntries = await listGenerateMenuEntriesForAdmin(workspaceSubject)
  const listboardEntries = generateMenuEntries.filter((entry) => entry.entry_type === 'listboard' && entry.deleted_at === null)
  const initialSelectedBoardId = listboardEntries[0]?.id ?? null
  const initialGeneratePosts = initialSelectedBoardId
    ? await listGenerateListboardPostsForAdmin(initialSelectedBoardId, workspaceSubject)
    : []

  return (
    <GenerateProductsClient
      generateMenuEntries={generateMenuEntries}
      initialGeneratePosts={initialGeneratePosts}
      initialSelectedBoardId={initialSelectedBoardId}
      workspaceSubject={workspaceSubject}
    />
  )
}
