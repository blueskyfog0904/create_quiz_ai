import { requireAdmin } from '@/lib/auth'
import {
  listGenerateListboardPostsForAdmin,
  listGenerateMenuEntriesForAdmin,
} from '@/lib/generate-menu-server'
import GenerateProductsClient from './generate-products-client'

export default async function GenerateProductsPage() {
  await requireAdmin()

  const generateMenuEntries = await listGenerateMenuEntriesForAdmin()
  const listboardEntries = generateMenuEntries.filter((entry) => entry.entry_type === 'listboard' && entry.deleted_at === null)
  const initialSelectedBoardId = listboardEntries[0]?.id ?? null
  const initialGeneratePosts = initialSelectedBoardId
    ? await listGenerateListboardPostsForAdmin(initialSelectedBoardId)
    : []

  return (
    <GenerateProductsClient
      generateMenuEntries={generateMenuEntries}
      initialGeneratePosts={initialGeneratePosts}
      initialSelectedBoardId={initialSelectedBoardId}
    />
  )
}
