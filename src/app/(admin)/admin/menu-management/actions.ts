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
  archiveGenerateMenuEntry,
  createGenerateMenuEntry,
  getGenerateChildrenSourceMode,
  getGenerateMenuEntriesBackfillStatus,
  listGenerateMenuEntriesForAdmin,
  reorderGenerateMenuEntries,
  updateGenerateMenuEntry,
} from '@/lib/generate-menu-server'
import type { GenerateMenuEntryAdminRow } from '@/lib/generate-menu'
import type { TablesInsert, TablesUpdate } from '@/types/supabase'

export interface MenuManagementPageData {
  initialConfig: HeaderNavigationConfig
  generateMenuEntries: GenerateMenuEntryAdminRow[]
  generateChildrenSourceMode: ReturnType<typeof getGenerateChildrenSourceMode>
  hasGenerateParent: boolean
  backfillStatus: {
    sourceMode: ReturnType<typeof getGenerateChildrenSourceMode>
    entryCount: number
  }
}

function revalidateMenuRelatedPaths() {
  revalidatePath('/', 'layout')
  revalidatePath('/generate', 'layout')
  revalidatePath('/admin')
  revalidatePath('/admin/menu-management')
}

export async function getMenuManagementData(): Promise<MenuManagementPageData> {
  await requireAdmin()

  const [initialConfig, generateMenuEntries, backfillStatus] = await Promise.all([
    getBaseHeaderNavigationConfig(),
    listGenerateMenuEntriesForAdmin(),
    getGenerateMenuEntriesBackfillStatus(),
  ])

  return {
    initialConfig,
    generateMenuEntries,
    generateChildrenSourceMode: getGenerateChildrenSourceMode(),
    hasGenerateParent: initialConfig.items.some((item) => item.href === '/generate'),
    backfillStatus,
  }
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
