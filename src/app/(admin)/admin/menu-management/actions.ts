'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import {
  saveHeaderNavigationConfig as persistHeaderNavigationConfig,
  getBaseHeaderNavigationConfig,
} from '@/lib/header-navigation-server'
import {
  normalizeHeaderNavigationConfig,
  validateHeaderNavigationConfig,
  type HeaderNavigationConfig,
} from '@/lib/header-navigation'
import {
  archiveGenerateListboardPost,
  archiveGenerateMenuEntry,
  backfillGenerateMenuEntriesFromHeader,
  createGenerateListboardPost,
  createGenerateMenuEntry,
  getGenerateChildrenSourceMode,
  getGenerateMenuEntriesBackfillStatus,
  listGenerateListboardPostsForAdmin,
  listGenerateMenuEntriesForAdmin,
  reorderGenerateMenuEntries,
  updateGenerateListboardPost,
  updateGenerateMenuEntry,
  type LegacyGenerateChildSummary,
} from '@/lib/generate-menu-server'
import type {
  GenerateListboardPost,
  GenerateMenuEntryAdminRow,
} from '@/lib/generate-menu'
import type { TablesInsert, TablesUpdate } from '@/types/supabase'

export interface MenuManagementPageData {
  initialConfig: HeaderNavigationConfig
  generateMenuEntries: GenerateMenuEntryAdminRow[]
  initialGeneratePosts: GenerateListboardPost[]
  initialSelectedBoardId: string | null
  generateChildrenSourceMode: ReturnType<typeof getGenerateChildrenSourceMode>
  hasGenerateParent: boolean
  backfillStatus: {
    sourceMode: ReturnType<typeof getGenerateChildrenSourceMode>
    entryCount: number
    missingLegacyChildren: LegacyGenerateChildSummary[]
  }
}

function revalidateMenuRelatedPaths() {
  revalidatePath('/', 'layout')
  revalidatePath('/generate', 'layout')
  revalidatePath('/generate/boards', 'layout')
  revalidatePath('/admin')
  revalidatePath('/admin/menu-management')
}

export async function getMenuManagementData(): Promise<MenuManagementPageData> {
  await requireAdmin()

  const initialConfig = await getBaseHeaderNavigationConfig()
  const generateMenuEntries = await listGenerateMenuEntriesForAdmin()
  const backfillStatus = await getGenerateMenuEntriesBackfillStatus(initialConfig)
  const firstListboardEntry = generateMenuEntries.find((entry) => entry.entry_type === 'listboard' && entry.deleted_at === null)
  const initialGeneratePosts = firstListboardEntry
    ? await listGenerateListboardPostsForAdmin(firstListboardEntry.id)
    : []

  return {
    initialConfig,
    generateMenuEntries,
    initialGeneratePosts,
    initialSelectedBoardId: firstListboardEntry?.id ?? null,
    generateChildrenSourceMode: getGenerateChildrenSourceMode(),
    hasGenerateParent: initialConfig.items.some((item) => item.href === '/generate'),
    backfillStatus,
  }
}

export async function getGenerateListboardPostsAction(menuEntryId: string) {
  await requireAdmin()
  const posts = await listGenerateListboardPostsForAdmin(menuEntryId)
  return { success: true, data: posts }
}

export async function saveMenuManagementConfig(input: HeaderNavigationConfig) {
  await requireAdmin()

  const normalizedConfig = normalizeHeaderNavigationConfig(input)
  validateHeaderNavigationConfig(normalizedConfig)

  const savedConfig = await persistHeaderNavigationConfig(normalizedConfig)
  revalidateMenuRelatedPaths()

  return {
    success: true,
    data: savedConfig,
  }
}

export async function createGenerateMenuEntryAction(
  input: Pick<TablesInsert<'generate_menu_entries'>, 'title' | 'slug' | 'entry_type' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>
) {
  await requireAdmin()
  const entry = await createGenerateMenuEntry(input)
  revalidateMenuRelatedPaths()
  return { success: true, data: entry }
}

export async function updateGenerateMenuEntryAction(
  id: string,
  input: Pick<TablesUpdate<'generate_menu_entries'>, 'title' | 'slug' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>
) {
  await requireAdmin()
  const entry = await updateGenerateMenuEntry(id, input)
  revalidateMenuRelatedPaths()
  return { success: true, data: entry }
}

export async function archiveGenerateMenuEntryAction(id: string) {
  await requireAdmin()
  await archiveGenerateMenuEntry(id)
  revalidateMenuRelatedPaths()
  return { success: true }
}

export async function reorderGenerateMenuEntriesAction(ids: string[]) {
  await requireAdmin()
  await reorderGenerateMenuEntries(ids)
  revalidateMenuRelatedPaths()
  return { success: true }
}

export async function backfillGenerateMenuEntriesAction() {
  await requireAdmin()
  const config = await getBaseHeaderNavigationConfig()
  const entries = await backfillGenerateMenuEntriesFromHeader(config)
  revalidateMenuRelatedPaths()
  return { success: true, data: entries }
}

export async function createGenerateListboardPostAction(
  input: Pick<TablesInsert<'generate_listboard_posts'>, 'menu_entry_id' | 'title' | 'passage_text' | 'exam_year' | 'exam_month' | 'grade_level' | 'status' | 'is_active'>
) {
  const user = await requireAdmin()
  const post = await createGenerateListboardPost({
    ...input,
    created_by: user.id,
    updated_by: user.id,
  })
  revalidateMenuRelatedPaths()
  return { success: true, data: post }
}

export async function updateGenerateListboardPostAction(
  id: string,
  input: Pick<TablesUpdate<'generate_listboard_posts'>, 'title' | 'passage_text' | 'exam_year' | 'exam_month' | 'grade_level' | 'status' | 'is_active'>
) {
  const user = await requireAdmin()
  const post = await updateGenerateListboardPost(id, {
    ...input,
    updated_by: user.id,
  })
  revalidateMenuRelatedPaths()
  return { success: true, data: post }
}

export async function archiveGenerateListboardPostAction(id: string) {
  await requireAdmin()
  await archiveGenerateListboardPost(id)
  revalidateMenuRelatedPaths()
  return { success: true }
}
