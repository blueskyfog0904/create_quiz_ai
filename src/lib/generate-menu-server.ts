import { createAdminClient } from '@/lib/supabase/bypass'
import type { TablesInsert, TablesUpdate } from '@/types/supabase'
import {
  buildGenerateMenuHref,
  type GenerateChildrenSourceMode,
  type GenerateMenuEntry,
  type GenerateMenuEntryAdminRow,
} from '@/lib/generate-menu'

const GENERATE_CHILDREN_SOURCE_MODE: GenerateChildrenSourceMode = 'hybrid_fallback'

function getAdminSupabase() {
  return createAdminClient()
}

function normalizeText(value?: string | null) {
  return value?.trim() ?? ''
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

function validateEntryInput(input: {
  title?: string
  slug?: string
  entry_type?: string
}) {
  const title = normalizeText(input.title)
  if (!title) {
    throw new Error('메뉴명을 입력해주세요.')
  }

  if (title.length > 30) {
    throw new Error('메뉴명은 30자 이하로 입력해주세요.')
  }

  const entryType = input.entry_type
  if (entryType !== 'personal_generate' && entryType !== 'listboard') {
    throw new Error('메뉴 유형이 올바르지 않습니다.')
  }

  const slug = normalizeSlug(input.slug || '')
  if (!slug) {
    throw new Error('slug를 입력해주세요.')
  }

  if (entryType === 'personal_generate' && slug !== 'personal') {
    throw new Error('개인지문 메뉴의 slug는 personal로 고정됩니다.')
  }

  return {
    title,
    slug,
    entryType,
  }
}

async function getPostCount(menuEntryId: string) {
  const supabase = getAdminSupabase()
  const { count, error } = await supabase
    .from('generate_listboard_posts')
    .select('id', { count: 'exact', head: true })
    .eq('menu_entry_id', menuEntryId)
    .is('deleted_at', null)

  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

export function getGenerateChildrenSourceMode() {
  return GENERATE_CHILDREN_SOURCE_MODE
}

export async function listGenerateMenuEntriesForAdmin(): Promise<GenerateMenuEntryAdminRow[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .order('sort_order')
    .order('created_at')

  if (error) {
    throw new Error(error.message)
  }

  const entries = data ?? []
  const { data: posts, error: postError } = await supabase
    .from('generate_listboard_posts')
    .select('menu_entry_id')
    .is('deleted_at', null)

  if (postError) {
    throw new Error(postError.message)
  }

  const counts = (posts ?? []).reduce<Record<string, number>>((acc, post) => {
    acc[post.menu_entry_id] = (acc[post.menu_entry_id] ?? 0) + 1
    return acc
  }, {})

  return entries.map((entry) => ({
    ...entry,
    postCount: counts[entry.id] ?? 0,
  }))
}

export async function listVisibleGenerateMenuEntries(): Promise<GenerateMenuEntry[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .is('deleted_at', null)
    .eq('is_visible', true)
    .eq('is_active', true)
    .order('sort_order')
    .order('created_at')

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function getGenerateMenuEntryBySlug(slug: string) {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .eq('slug', slug)
    .is('deleted_at', null)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function getGenerateMenuEntriesBackfillStatus() {
  const supabase = getAdminSupabase()
  const { count, error } = await supabase
    .from('generate_menu_entries')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)

  if (error) {
    throw new Error(error.message)
  }

  return {
    sourceMode: getGenerateChildrenSourceMode(),
    entryCount: count ?? 0,
  }
}

export async function createGenerateMenuEntry(
  input: Pick<TablesInsert<'generate_menu_entries'>, 'title' | 'slug' | 'entry_type' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>
) {
  const supabase = getAdminSupabase()
  const normalized = validateEntryInput(input)
  const slug = normalized.entryType === 'personal_generate' ? 'personal' : normalized.slug

  const payload: TablesInsert<'generate_menu_entries'> = {
    entry_key: slug,
    slug,
    title: normalized.title,
    entry_type: normalized.entryType,
    description: normalizeText(input.description) || null,
    sort_order: input.sort_order ?? 0,
    is_visible: input.is_visible ?? true,
    is_active: input.is_active ?? true,
    search_config: input.search_config ?? {},
  }

  const { data, error } = await supabase
    .from('generate_menu_entries')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function updateGenerateMenuEntry(
  id: string,
  input: Pick<TablesUpdate<'generate_menu_entries'>, 'title' | 'slug' | 'description' | 'sort_order' | 'is_visible' | 'is_active' | 'search_config'>
) {
  const supabase = getAdminSupabase()
  const { data: current, error: currentError } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .eq('id', id)
    .single()

  if (currentError || !current) {
    throw new Error('수정할 문제생성 메뉴를 찾을 수 없습니다.')
  }

  const normalizedTitle = normalizeText(input.title ?? current.title)
  if (!normalizedTitle) {
    throw new Error('메뉴명을 입력해주세요.')
  }

  const nextSlug = current.entry_type === 'personal_generate'
    ? 'personal'
    : normalizeSlug(input.slug ?? current.slug)

  if (!nextSlug) {
    throw new Error('slug를 입력해주세요.')
  }

  if (current.entry_type === 'personal_generate' && nextSlug !== 'personal') {
    throw new Error('개인지문 메뉴의 slug는 변경할 수 없습니다.')
  }

  if (nextSlug !== current.slug) {
    const linkedPostCount = await getPostCount(id)
    if (linkedPostCount > 0) {
      throw new Error('게시글이 연결된 메뉴의 slug는 현재 변경할 수 없습니다.')
    }
  }

  const payload: TablesUpdate<'generate_menu_entries'> = {
    title: normalizedTitle,
    slug: nextSlug,
    description: normalizeText(input.description ?? current.description) || null,
    sort_order: input.sort_order ?? current.sort_order,
    is_visible: input.is_visible ?? current.is_visible,
    is_active: input.is_active ?? current.is_active,
    search_config: input.search_config ?? current.search_config,
  }

  const { data, error } = await supabase
    .from('generate_menu_entries')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function archiveGenerateMenuEntry(id: string) {
  const supabase = getAdminSupabase()
  const { data: current, error: currentError } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .eq('id', id)
    .single()

  if (currentError || !current) {
    throw new Error('삭제할 문제생성 메뉴를 찾을 수 없습니다.')
  }

  if (current.entry_type === 'personal_generate') {
    throw new Error('개인지문 메뉴는 삭제할 수 없습니다.')
  }

  const { error } = await supabase
    .from('generate_menu_entries')
    .update({
      is_active: false,
      is_visible: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}

export async function reorderGenerateMenuEntries(ids: string[]) {
  const supabase = getAdminSupabase()

  const results = await Promise.all(ids.map((id, index) => (
    supabase
      .from('generate_menu_entries')
      .update({ sort_order: (index + 1) * 10 })
      .eq('id', id)
  )))

  const failed = results.find((result) => result.error)
  if (failed?.error) {
    throw new Error(failed.error.message)
  }
}

export function getGenerateMenuPreviewPath(entry: Pick<GenerateMenuEntry, 'entry_type' | 'slug'>) {
  return buildGenerateMenuHref(entry)
}
