import { requireAdmin } from '@/lib/auth'
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
  await requireAdmin()
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
