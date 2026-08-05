import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import { listVisibleMarketMenuEntries } from '@/lib/market-menu-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

export const UNGROUPED_MARKET_MENU_GROUP_ID = 'ungrouped'
export const UNGROUPED_MARKET_MENU_GROUP_TITLE = '기타'

export interface MarketMenuGroupRow {
  id: string
  workspace_subject: WorkspaceSubject
  group_key: string
  title: string
  sort_order: number
  is_visible: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface MarketMenuGroupWriteInput {
  groupKey?: string
  title?: string
  sortOrder?: number
  isVisible?: boolean
  isActive?: boolean
}

export interface VisibleMarketMenuGroupEntry {
  id: string
  slug: string
  title: string
  description: string | null
  sortOrder: number
  groupId: string | null
}

export interface VisibleMarketMenuGroup {
  id: string
  title: string
  sortOrder: number
  isFallback: boolean
  entries: VisibleMarketMenuGroupEntry[]
}

type MarketMenuEntryWithGroup = {
  id: string
  slug: string
  title: string
  description: string | null
  sort_order: number
  group_id?: string | null
}

type DatabaseError = {
  code?: string | null
  message?: string | null
  details?: string | null
}

function getAdminSupabase(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient
}

function isMissingMarketMenuGroupSchemaError(error: DatabaseError) {
  const message = error.message ?? ''
  const details = error.details ?? ''

  return error.code === 'PGRST205'
    || error.code === 'PGRST204'
    || message.includes("Could not find the table 'public.market_menu_groups'")
    || message.includes("Could not find the 'group_id' column")
    || message.includes('relation "public.market_menu_groups" does not exist')
    || message.includes('relation "market_menu_groups" does not exist')
    || details.includes('market_menu_groups')
}

function normalizeWriteError(error: DatabaseError) {
  if (isMissingMarketMenuGroupSchemaError(error)) {
    return new Error('문제마켓 카테고리 그룹 스키마가 아직 준비되지 않았습니다.')
  }

  if (error.code === '23505') {
    return new Error('같은 과목에 동일한 카테고리 그룹 key가 이미 있습니다.')
  }

  if (error.code === '23503') {
    return new Error('같은 과목의 카테고리와 메뉴만 연결할 수 있습니다.')
  }

  return new Error(error.message ?? '문제마켓 카테고리 그룹 처리 중 오류가 발생했습니다.')
}

function normalizeTitle(value?: string | null) {
  return value?.trim() ?? ''
}

export function normalizeMarketMenuGroupKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

function validateGroupInput(
  input: MarketMenuGroupWriteInput,
  current?: Pick<MarketMenuGroupRow, 'group_key' | 'title' | 'sort_order' | 'is_visible' | 'is_active'>
) {
  const title = normalizeTitle(input.title ?? current?.title)
  if (!title) {
    throw new Error('카테고리 그룹명을 입력해주세요.')
  }

  if (title.length > 30) {
    throw new Error('카테고리 그룹명은 30자 이하로 입력해주세요.')
  }

  const groupKey = normalizeMarketMenuGroupKey(input.groupKey ?? current?.group_key ?? '')
  if (!groupKey) {
    throw new Error('카테고리 그룹 key를 입력해주세요.')
  }

  if (groupKey.length > 50) {
    throw new Error('카테고리 그룹 key는 50자 이하로 입력해주세요.')
  }

  return {
    group_key: groupKey,
    title,
    sort_order: input.sortOrder ?? current?.sort_order ?? 0,
    is_visible: input.isVisible ?? current?.is_visible ?? true,
    is_active: input.isActive ?? current?.is_active ?? true,
  }
}

function validateUniqueIds(ids: string[]) {
  if (new Set(ids).size !== ids.length) {
    throw new Error('중복된 항목은 정렬하거나 배치할 수 없습니다.')
  }
}

export async function listMarketMenuGroupsForAdmin(
  workspaceSubject: WorkspaceSubject
): Promise<MarketMenuGroupRow[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_menu_groups')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .order('sort_order')
    .order('created_at')

  if (error) {
    if (isMissingMarketMenuGroupSchemaError(error)) {
      return []
    }

    throw normalizeWriteError(error)
  }

  return (data ?? []) as MarketMenuGroupRow[]
}

export async function listVisibleMarketMenuGroups(
  workspaceSubject: WorkspaceSubject
): Promise<VisibleMarketMenuGroup[]> {
  const supabase = getAdminSupabase()
  const [{ data: groupData, error: groupError }, entryData] = await Promise.all([
    supabase
      .from('market_menu_groups')
      .select('*')
      .eq('workspace_subject', workspaceSubject)
      .is('deleted_at', null)
      .eq('is_visible', true)
      .eq('is_active', true)
      .order('sort_order')
      .order('created_at'),
    listVisibleMarketMenuEntries(workspaceSubject),
  ])

  if (groupError && !isMissingMarketMenuGroupSchemaError(groupError)) {
    throw normalizeWriteError(groupError)
  }

  const groups = (groupError ? [] : (groupData ?? [])) as MarketMenuGroupRow[]
  const entries = entryData as unknown as MarketMenuEntryWithGroup[]
  const visibleGroupIds = new Set(groups.map((group) => group.id))
  const entriesByGroup = new Map<string, VisibleMarketMenuGroupEntry[]>()
  const fallbackEntries: VisibleMarketMenuGroupEntry[] = []

  for (const entry of entries) {
    const normalizedEntry: VisibleMarketMenuGroupEntry = {
      id: entry.id,
      slug: entry.slug,
      title: entry.title,
      description: entry.description,
      sortOrder: entry.sort_order,
      groupId: entry.group_id ?? null,
    }

    if (entry.group_id && visibleGroupIds.has(entry.group_id)) {
      const groupEntries = entriesByGroup.get(entry.group_id) ?? []
      groupEntries.push(normalizedEntry)
      entriesByGroup.set(entry.group_id, groupEntries)
    } else {
      fallbackEntries.push(normalizedEntry)
    }
  }

  const navigationGroups: VisibleMarketMenuGroup[] = groups.map((group) => ({
    id: group.id,
    title: group.title,
    sortOrder: group.sort_order,
    isFallback: false,
    entries: entriesByGroup.get(group.id) ?? [],
  }))

  if (fallbackEntries.length > 0) {
    navigationGroups.push({
      id: UNGROUPED_MARKET_MENU_GROUP_ID,
      title: UNGROUPED_MARKET_MENU_GROUP_TITLE,
      sortOrder: Number.MAX_SAFE_INTEGER,
      isFallback: true,
      entries: fallbackEntries,
    })
  }

  return navigationGroups
}

export async function createMarketMenuGroup(
  input: MarketMenuGroupWriteInput,
  workspaceSubject: WorkspaceSubject
): Promise<MarketMenuGroupRow> {
  const supabase = getAdminSupabase()
  const payload = {
    workspace_subject: workspaceSubject,
    ...validateGroupInput(input),
  }
  const { data, error } = await supabase
    .from('market_menu_groups')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw normalizeWriteError(error)
  }

  return data as MarketMenuGroupRow
}

export async function updateMarketMenuGroup(
  id: string,
  input: MarketMenuGroupWriteInput,
  workspaceSubject: WorkspaceSubject
): Promise<MarketMenuGroupRow> {
  const supabase = getAdminSupabase()
  const { data: current, error: currentError } = await supabase
    .from('market_menu_groups')
    .select('*')
    .eq('id', id)
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .maybeSingle()

  if (currentError) {
    throw normalizeWriteError(currentError)
  }

  if (!current) {
    throw new Error('같은 과목에서 수정할 카테고리 그룹을 찾을 수 없습니다.')
  }

  const { data, error } = await supabase
    .from('market_menu_groups')
    .update(validateGroupInput(input, current as MarketMenuGroupRow))
    .eq('id', id)
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .select('*')
    .single()

  if (error) {
    throw normalizeWriteError(error)
  }

  return data as MarketMenuGroupRow
}

export async function archiveMarketMenuGroup(
  id: string,
  workspaceSubject: WorkspaceSubject
) {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_menu_groups')
    .update({
      is_visible: false,
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (error) {
    throw normalizeWriteError(error)
  }

  if (!data) {
    throw new Error('같은 과목에서 삭제할 카테고리 그룹을 찾을 수 없습니다.')
  }
}

export async function reorderMarketMenuGroups(
  ids: string[],
  workspaceSubject: WorkspaceSubject
) {
  validateUniqueIds(ids)
  if (ids.length === 0) {
    return
  }

  const supabase = getAdminSupabase()
  const { data: existing, error: existingError } = await supabase
    .from('market_menu_groups')
    .select('id')
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .in('id', ids)

  if (existingError) {
    throw normalizeWriteError(existingError)
  }

  if ((existing ?? []).length !== ids.length) {
    throw new Error('같은 과목의 카테고리 그룹만 정렬할 수 있습니다.')
  }

  const updates = await Promise.all(ids.map((id, index) => (
    supabase
      .from('market_menu_groups')
      .update({ sort_order: (index + 1) * 10 })
      .eq('id', id)
      .eq('workspace_subject', workspaceSubject)
      .is('deleted_at', null)
  )))
  const failed = updates.find((result) => result.error)

  if (failed?.error) {
    throw normalizeWriteError(failed.error)
  }
}

export async function assignMarketMenuEntriesToGroup(
  ids: string[],
  groupId: string | null,
  workspaceSubject: WorkspaceSubject
) {
  validateUniqueIds(ids)
  if (ids.length === 0) {
    return
  }

  const supabase = getAdminSupabase()

  if (groupId) {
    const { data: group, error: groupError } = await supabase
      .from('market_menu_groups')
      .select('id')
      .eq('id', groupId)
      .eq('workspace_subject', workspaceSubject)
      .is('deleted_at', null)
      .maybeSingle()

    if (groupError) {
      throw normalizeWriteError(groupError)
    }

    if (!group) {
      throw new Error('같은 과목에서 배치할 카테고리 그룹을 찾을 수 없습니다.')
    }
  }

  const { data: entries, error: entryError } = await supabase
    .from('market_menu_entries')
    .select('id')
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .in('id', ids)

  if (entryError) {
    throw normalizeWriteError(entryError)
  }

  if ((entries ?? []).length !== ids.length) {
    throw new Error('같은 과목의 문제마켓 메뉴만 배치할 수 있습니다.')
  }

  const { error } = await supabase
    .from('market_menu_entries')
    .update({ group_id: groupId })
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .in('id', ids)

  if (error) {
    throw normalizeWriteError(error)
  }
}
