'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import {
} from '@/lib/admin-sidebar'
import type { AdminSidebarNavigationConfig } from '@/lib/admin-sidebar'
import {
  getAdminSidebarNavigationConfig,
  saveAdminSidebarNavigationConfig,
} from '@/lib/admin-sidebar-server'
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
import {
  archiveMarketMenuGroup,
  assignMarketMenuEntriesToGroup,
  createMarketMenuGroup,
  listMarketMenuGroupsForAdmin,
  reorderMarketMenuGroups,
  updateMarketMenuGroup,
  type MarketMenuGroupRow,
  type MarketMenuGroupWriteInput,
} from '@/lib/market-menu-groups-server'
import {
  assertWorkspaceSubject,
  DEFAULT_WORKSPACE_SUBJECT,
  withWorkspacePrefix,
  type WorkspaceSubject,
} from '@/lib/workspace-subject'
import type { TablesInsert, TablesUpdate } from '@/types/supabase'

export interface MenuManagementPageData {
  workspaceSubject?: WorkspaceSubject
  initialConfig: HeaderNavigationConfig
  adminSidebarConfig: AdminSidebarNavigationConfig
  generateMenuEntries: GenerateMenuEntryAdminRow[]
  marketMenuEntries: MarketMenuEntryAdminRow[]
  marketMenuEntryGroupAssignments: Array<{
    entryId: string
    groupId: string | null
  }>
  marketMenuGroups: MarketMenuGroupRow[]
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

function revalidateMenuRelatedPaths(workspaceSubject: WorkspaceSubject) {
  const revalidateWorkspacePath = (subject: WorkspaceSubject, path: string, type: 'layout' | 'page') => {
    revalidatePath(path, type)
    revalidatePath(withWorkspacePrefix(subject, path), type)
  }

  revalidateWorkspacePath(DEFAULT_WORKSPACE_SUBJECT, '/', 'layout')
  revalidateWorkspacePath('korean', '/', 'layout')
  revalidateWorkspacePath(DEFAULT_WORKSPACE_SUBJECT, '/generate', 'layout')
  revalidateWorkspacePath(DEFAULT_WORKSPACE_SUBJECT, '/generate/boards', 'layout')
  revalidateWorkspacePath(DEFAULT_WORKSPACE_SUBJECT, '/market', 'layout')
  revalidateWorkspacePath('korean', '/market', 'layout')
  revalidateWorkspacePath(DEFAULT_WORKSPACE_SUBJECT, '/library', 'layout')
  revalidateWorkspacePath('korean', '/library', 'layout')
  revalidateWorkspacePath(DEFAULT_WORKSPACE_SUBJECT, '/library/mypassages', 'layout')
  revalidateWorkspacePath('korean', '/library/mypassages', 'layout')
  revalidateWorkspacePath(DEFAULT_WORKSPACE_SUBJECT, '/library/purchased', 'layout')
  revalidateWorkspacePath('korean', '/library/purchased', 'layout')
  revalidateWorkspacePath(DEFAULT_WORKSPACE_SUBJECT, '/library/exam-papers', 'layout')
  revalidateWorkspacePath('korean', '/library/exam-papers', 'layout')
  revalidateWorkspacePath(DEFAULT_WORKSPACE_SUBJECT, '/library/market', 'layout')
  revalidateWorkspacePath('korean', '/library/market', 'layout')
  revalidatePath('/admin')
  revalidatePath('/admin', 'layout')
  revalidatePath(`/admin/menu-management?subject=${workspaceSubject}`)
  revalidatePath('/preview/solvook-concept')
  revalidatePath('/preview/solvook-concept/boards/[slug]', 'page')
}

export async function getMenuManagementData(workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT): Promise<MenuManagementPageData> {
  await requireAdmin()

  const initialConfig = await getBaseHeaderNavigationConfig(workspaceSubject)
  const adminSidebarConfig = await getAdminSidebarNavigationConfig(workspaceSubject)
  const generateMenuEntries = await listGenerateMenuEntriesForAdmin(workspaceSubject)
  const marketMenuEntries = await listMarketMenuEntriesForAdmin(workspaceSubject)
  const marketMenuEntryGroupAssignments = (
    marketMenuEntries as Array<MarketMenuEntryAdminRow & { group_id?: string | null }>
  ).map((entry) => ({
    entryId: entry.id,
    groupId: entry.group_id ?? null,
  }))
  const marketMenuGroups = await listMarketMenuGroupsForAdmin(workspaceSubject)
  const backfillStatus = await getGenerateMenuEntriesBackfillStatus(initialConfig, workspaceSubject)
  const marketBackfillStatus = await getMarketMenuEntriesBackfillStatus(initialConfig, workspaceSubject)
  const firstListboardEntry = generateMenuEntries.find((entry) => entry.entry_type === 'listboard' && entry.deleted_at === null)
  const initialGeneratePosts = firstListboardEntry
    ? await listGenerateListboardPostsForAdmin(firstListboardEntry.id, workspaceSubject)
    : []

  return {
    initialConfig,
    adminSidebarConfig,
    generateMenuEntries,
    marketMenuEntries,
    marketMenuEntryGroupAssignments,
    marketMenuGroups,
    initialGeneratePosts,
    initialSelectedBoardId: firstListboardEntry?.id ?? null,
    generateChildrenSourceMode: getGenerateChildrenSourceMode(),
    marketChildrenSourceMode: getMarketChildrenSourceMode(),
    hasGenerateParent: initialConfig.items.some((item) => item.href === '/generate'),
    hasMarketParent: initialConfig.items.some((item) => item.href === '/market'),
    backfillStatus,
    marketBackfillStatus,
    workspaceSubject,
  }
}

export async function saveAdminSidebarNavigationConfigAction(
  input: AdminSidebarNavigationConfig,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()

  const savedConfig = await saveAdminSidebarNavigationConfig(input, workspaceSubject)
  revalidateMenuRelatedPaths(workspaceSubject)

  return {
    success: true,
    data: savedConfig,
  }
}

export async function getGenerateListboardPostsAction(menuEntryId: string, workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()
  const posts = await listGenerateListboardPostsForAdmin(menuEntryId, workspaceSubject)
  return { success: true, data: posts }
}

export async function getGenerateListboardPostItemsAction(postId: string, workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT): Promise<{ success: true, data: GenerateListboardPostItem[] }> {
  await requireAdmin()
  const items = await listGenerateListboardPostItemsForAdmin(postId, workspaceSubject)
  return { success: true, data: items }
}

export async function saveMenuManagementConfig(input: HeaderNavigationConfig, workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()

  const normalizedConfig = normalizeHeaderNavigationConfig(input)
  validateHeaderNavigationConfig(normalizedConfig)

  const savedConfig = await persistHeaderNavigationConfig(normalizedConfig, workspaceSubject)
  revalidateMenuRelatedPaths(workspaceSubject)

  return {
    success: true,
    data: savedConfig,
  }
}

export async function createGenerateMenuEntryAction(
  input: Pick<TablesInsert<'generate_menu_entries'>, 'title' | 'slug' | 'entry_type' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()
  const entry = await createGenerateMenuEntry(input, workspaceSubject)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: entry }
}

export async function updateGenerateMenuEntryAction(
  id: string,
  input: Pick<TablesUpdate<'generate_menu_entries'>, 'title' | 'slug' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()
  const entry = await updateGenerateMenuEntry(id, input)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: entry }
}

export async function archiveGenerateMenuEntryAction(id: string, workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()
  await archiveGenerateMenuEntry(id)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true }
}

export async function reorderGenerateMenuEntriesAction(ids: string[], workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()
  await reorderGenerateMenuEntries(ids)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true }
}

export async function backfillGenerateMenuEntriesAction(workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()
  const config = await getBaseHeaderNavigationConfig(workspaceSubject)
  const entries = await backfillGenerateMenuEntriesFromHeader(config, workspaceSubject)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: entries }
}

export async function createGenerateListboardPostAction(
  input: Pick<TablesInsert<'generate_listboard_posts'>, 'menu_entry_id' | 'title' | 'passage_text' | 'exam_year' | 'exam_month' | 'grade_level' | 'status' | 'is_active'>,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  const user = await requireAdmin()
  const post = await createGenerateListboardPost({
    ...input,
    created_by: user.id,
    updated_by: user.id,
  })
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: post }
}

export async function createGenerateListboardPostWithItemsAction(
  input: Pick<TablesInsert<'generate_listboard_posts'>, 'menu_entry_id' | 'title' | 'exam_year' | 'exam_month' | 'grade_level' | 'status' | 'is_active'>,
  items: Array<Pick<TablesInsert<'generate_listboard_post_items'>, 'question_number' | 'passage_text' | 'sort_order' | 'is_active'>>,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  const user = await requireAdmin()
  const result = await createGenerateListboardPostWithItems({
    ...input,
    created_by: user.id,
    updated_by: user.id,
  }, items)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: result }
}

export async function updateGenerateListboardPostAction(
  id: string,
  input: Pick<TablesUpdate<'generate_listboard_posts'>, 'title' | 'passage_text' | 'exam_year' | 'exam_month' | 'grade_level' | 'status' | 'is_active'>,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  const user = await requireAdmin()
  const post = await updateGenerateListboardPost(id, {
    ...input,
    updated_by: user.id,
  })
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: post }
}

export async function archiveGenerateListboardPostAction(id: string, workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()
  await archiveGenerateListboardPost(id)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true }
}

export async function createGenerateListboardPostItemAction(
  input: Pick<TablesInsert<'generate_listboard_post_items'>, 'post_id' | 'question_number' | 'passage_text' | 'sort_order' | 'is_active'>,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  const user = await requireAdmin()
  const item = await createGenerateListboardPostItem({
    ...input,
    created_by: user.id,
    updated_by: user.id,
  })
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: item }
}

export async function updateGenerateListboardPostItemAction(
  id: string,
  input: Pick<TablesUpdate<'generate_listboard_post_items'>, 'question_number' | 'passage_text' | 'sort_order' | 'is_active'>,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  const user = await requireAdmin()
  const item = await updateGenerateListboardPostItem(id, {
    ...input,
    updated_by: user.id,
  })
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: item }
}

export async function archiveGenerateListboardPostItemAction(id: string, workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()
  await archiveGenerateListboardPostItem(id)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true }
}


export async function createMarketMenuEntryAction(
  input: Pick<TablesInsert<'market_menu_entries'>, 'title' | 'slug' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()
  const entry = await createMarketMenuEntry(input, workspaceSubject)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: entry }
}

export async function updateMarketMenuEntryAction(
  id: string,
  input: Pick<TablesUpdate<'market_menu_entries'>, 'title' | 'slug' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()
  const entry = await updateMarketMenuEntry(id, input)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: entry }
}

export async function archiveMarketMenuEntryAction(id: string, workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()
  await archiveMarketMenuEntry(id)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true }
}

export async function reorderMarketMenuEntriesAction(ids: string[], workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()
  await reorderMarketMenuEntries(ids)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true }
}

export async function backfillMarketMenuEntriesAction(workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  await requireAdmin()
  const config = await getBaseHeaderNavigationConfig(workspaceSubject)
  const entries = await backfillMarketMenuEntriesFromHeader(config, workspaceSubject)
  revalidateMenuRelatedPaths(workspaceSubject)
  return { success: true, data: entries }
}

export async function createMarketMenuGroupAction(
  input: MarketMenuGroupWriteInput,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()
  const subject = assertWorkspaceSubject(workspaceSubject)
  const group = await createMarketMenuGroup(input, subject)
  revalidateMenuRelatedPaths(subject)
  return { success: true, data: group }
}

export async function updateMarketMenuGroupAction(
  id: string,
  input: MarketMenuGroupWriteInput,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()
  const subject = assertWorkspaceSubject(workspaceSubject)
  const group = await updateMarketMenuGroup(id, input, subject)
  revalidateMenuRelatedPaths(subject)
  return { success: true, data: group }
}

export async function archiveMarketMenuGroupAction(
  id: string,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()
  const subject = assertWorkspaceSubject(workspaceSubject)
  await archiveMarketMenuGroup(id, subject)
  revalidateMenuRelatedPaths(subject)
  return { success: true }
}

export async function reorderMarketMenuGroupsAction(
  ids: string[],
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()
  const subject = assertWorkspaceSubject(workspaceSubject)
  await reorderMarketMenuGroups(ids, subject)
  revalidateMenuRelatedPaths(subject)
  return { success: true }
}

export async function assignMarketMenuEntriesToGroupAction(
  ids: string[],
  groupId: string | null,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
) {
  await requireAdmin()
  const subject = assertWorkspaceSubject(workspaceSubject)
  await assignMarketMenuEntriesToGroup(ids, groupId, subject)
  revalidateMenuRelatedPaths(subject)
  return { success: true }
}
