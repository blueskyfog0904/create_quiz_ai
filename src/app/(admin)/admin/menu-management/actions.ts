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
  archiveGenerateListboardPostItem,
  archiveGenerateListboardPost,
  archiveGenerateMenuEntry,
  backfillGenerateMenuEntriesFromHeader,
  createGenerateListboardPostItem,
  createGenerateListboardPostWithItems,
  createGenerateListboardPost,
  createGenerateMenuEntry,
  getGenerateChildrenSourceMode,
  getGenerateMenuEntriesBackfillStatus,
  listGenerateListboardPostItemsForAdmin,
  listGenerateListboardPostsForAdmin,
  listGenerateMenuEntriesForAdmin,
  reorderGenerateMenuEntries,
  updateGenerateListboardPostItem,
  updateGenerateListboardPost,
  updateGenerateMenuEntry,
  type LegacyGenerateChildSummary,
} from '@/lib/generate-menu-server'
import type {
  GenerateListboardPostItem,
  GenerateListboardPost,
  GenerateMenuEntryAdminRow,
} from '@/lib/generate-menu'
import {
  archiveMarketMenuEntry,
  backfillMarketMenuEntriesFromHeader,
  createMarketMenuEntry,
  getMarketChildrenSourceMode,
  getMarketMenuEntriesBackfillStatus,
  listMarketMenuEntriesForAdmin,
  reorderMarketMenuEntries,
  updateMarketMenuEntry,
  type LegacyMarketChildSummary,
} from '@/lib/market-menu-server'
import type { MarketMenuEntryAdminRow } from '@/lib/market-menu'
import { DEFAULT_WORKSPACE_SUBJECT, withWorkspacePrefix } from '@/lib/workspace-subject'
import type { TablesInsert, TablesUpdate } from '@/types/supabase'

export interface MenuManagementPageData {
  initialConfig: HeaderNavigationConfig
  generateMenuEntries: GenerateMenuEntryAdminRow[]
  marketMenuEntries: MarketMenuEntryAdminRow[]
  initialGeneratePosts: GenerateListboardPost[]
  initialSelectedBoardId: string | null
  generateChildrenSourceMode: ReturnType<typeof getGenerateChildrenSourceMode>
  marketChildrenSourceMode: ReturnType<typeof getMarketChildrenSourceMode>
  hasGenerateParent: boolean
  hasMarketParent: boolean
  backfillStatus: {
    sourceMode: ReturnType<typeof getGenerateChildrenSourceMode>
    entryCount: number
    missingLegacyChildren: LegacyGenerateChildSummary[]
  }
  marketBackfillStatus: {
    sourceMode: ReturnType<typeof getMarketChildrenSourceMode>
    entryCount: number
    missingLegacyChildren: LegacyMarketChildSummary[]
  }
}

function revalidateMenuRelatedPaths() {
  const revalidateLegacyAndEnglishPath = (path: string, type: 'layout' | 'page') => {
    revalidatePath(path, type)
    revalidatePath(withWorkspacePrefix(DEFAULT_WORKSPACE_SUBJECT, path), type)
  }

  revalidateLegacyAndEnglishPath('/', 'layout')
  revalidateLegacyAndEnglishPath('/generate', 'layout')
  revalidateLegacyAndEnglishPath('/generate/boards', 'layout')
  revalidateLegacyAndEnglishPath('/market', 'layout')
  revalidateLegacyAndEnglishPath('/library/purchased', 'layout')
  revalidatePath('/admin')
  revalidatePath('/admin/menu-management')
}

export async function getMenuManagementData(): Promise<MenuManagementPageData> {
  await requireAdmin()

  const initialConfig = await getBaseHeaderNavigationConfig()
  const generateMenuEntries = await listGenerateMenuEntriesForAdmin()
  const marketMenuEntries = await listMarketMenuEntriesForAdmin()
  const backfillStatus = await getGenerateMenuEntriesBackfillStatus(initialConfig)
  const marketBackfillStatus = await getMarketMenuEntriesBackfillStatus(initialConfig)
  const firstListboardEntry = generateMenuEntries.find((entry) => entry.entry_type === 'listboard' && entry.deleted_at === null)
  const initialGeneratePosts = firstListboardEntry
    ? await listGenerateListboardPostsForAdmin(firstListboardEntry.id)
    : []

  return {
    initialConfig,
    generateMenuEntries,
    marketMenuEntries,
    initialGeneratePosts,
    initialSelectedBoardId: firstListboardEntry?.id ?? null,
    generateChildrenSourceMode: getGenerateChildrenSourceMode(),
    marketChildrenSourceMode: getMarketChildrenSourceMode(),
    hasGenerateParent: initialConfig.items.some((item) => item.href === '/generate'),
    hasMarketParent: initialConfig.items.some((item) => item.href === '/market'),
    backfillStatus,
    marketBackfillStatus,
  }
}

export async function getGenerateListboardPostsAction(menuEntryId: string) {
  await requireAdmin()
  const posts = await listGenerateListboardPostsForAdmin(menuEntryId)
  return { success: true, data: posts }
}

export async function getGenerateListboardPostItemsAction(postId: string): Promise<{ success: true, data: GenerateListboardPostItem[] }> {
  await requireAdmin()
  const items = await listGenerateListboardPostItemsForAdmin(postId)
  return { success: true, data: items }
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

export async function createGenerateListboardPostWithItemsAction(
  input: Pick<TablesInsert<'generate_listboard_posts'>, 'menu_entry_id' | 'title' | 'exam_year' | 'exam_month' | 'grade_level' | 'status' | 'is_active'>,
  items: Array<Pick<TablesInsert<'generate_listboard_post_items'>, 'question_number' | 'passage_text' | 'sort_order' | 'is_active'>>
) {
  const user = await requireAdmin()
  const result = await createGenerateListboardPostWithItems({
    ...input,
    created_by: user.id,
    updated_by: user.id,
  }, items)
  revalidateMenuRelatedPaths()
  return { success: true, data: result }
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

export async function createGenerateListboardPostItemAction(
  input: Pick<TablesInsert<'generate_listboard_post_items'>, 'post_id' | 'question_number' | 'passage_text' | 'sort_order' | 'is_active'>
) {
  const user = await requireAdmin()
  const item = await createGenerateListboardPostItem({
    ...input,
    created_by: user.id,
    updated_by: user.id,
  })
  revalidateMenuRelatedPaths()
  return { success: true, data: item }
}

export async function updateGenerateListboardPostItemAction(
  id: string,
  input: Pick<TablesUpdate<'generate_listboard_post_items'>, 'question_number' | 'passage_text' | 'sort_order' | 'is_active'>
) {
  const user = await requireAdmin()
  const item = await updateGenerateListboardPostItem(id, {
    ...input,
    updated_by: user.id,
  })
  revalidateMenuRelatedPaths()
  return { success: true, data: item }
}

export async function archiveGenerateListboardPostItemAction(id: string) {
  await requireAdmin()
  await archiveGenerateListboardPostItem(id)
  revalidateMenuRelatedPaths()
  return { success: true }
}


export async function createMarketMenuEntryAction(
  input: Pick<TablesInsert<'market_menu_entries'>, 'title' | 'slug' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>
) {
  await requireAdmin()
  const entry = await createMarketMenuEntry(input)
  revalidateMenuRelatedPaths()
  return { success: true, data: entry }
}

export async function updateMarketMenuEntryAction(
  id: string,
  input: Pick<TablesUpdate<'market_menu_entries'>, 'title' | 'slug' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>
) {
  await requireAdmin()
  const entry = await updateMarketMenuEntry(id, input)
  revalidateMenuRelatedPaths()
  return { success: true, data: entry }
}

export async function archiveMarketMenuEntryAction(id: string) {
  await requireAdmin()
  await archiveMarketMenuEntry(id)
  revalidateMenuRelatedPaths()
  return { success: true }
}

export async function reorderMarketMenuEntriesAction(ids: string[]) {
  await requireAdmin()
  await reorderMarketMenuEntries(ids)
  revalidateMenuRelatedPaths()
  return { success: true }
}

export async function backfillMarketMenuEntriesAction() {
  await requireAdmin()
  const config = await getBaseHeaderNavigationConfig()
  const entries = await backfillMarketMenuEntriesFromHeader(config)
  revalidateMenuRelatedPaths()
  return { success: true, data: entries }
}
