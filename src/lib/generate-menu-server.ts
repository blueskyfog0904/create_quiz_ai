import { createAdminClient } from '@/lib/supabase/bypass'
import type { HeaderNavigationConfig, HeaderMenuChildItem } from '@/lib/header-navigation'
import {
  buildGenerateMenuHref,
  LISTBOARD_GRADE_OPTIONS,
  normalizeListboardGradeLevel,
  type GenerateChildrenSourceMode,
  type GenerateListboardPost,
  type GenerateListboardPostItem,
  type GenerateMenuEntry,
  type GenerateMenuEntryAdminRow,
} from '@/lib/generate-menu'
import type { TablesInsert, TablesUpdate } from '@/types/supabase'

const GENERATE_CHILDREN_SOURCE_MODE: GenerateChildrenSourceMode = 'hybrid_fallback'

export interface LegacyGenerateChildSummary {
  id: string
  title: string
  href: string
  isActive: boolean
  entryKey: string
  slug: string
  entryType: 'personal_generate' | 'listboard'
  existsInDb: boolean
}

function getAdminSupabase() {
  return createAdminClient()
}

function normalizeText(value?: string | null) {
  return value?.trim() ?? ''
}

function normalizeQuestionNumber(value?: string | null) {
  return value?.trim() ?? ''
}

function validateListboardExamMetadata(input: { exam_year?: number | null, exam_month?: number | null, grade_level?: string | null }) {
  const examYear = input.exam_year ?? null
  const examMonth = input.exam_month ?? null
  const gradeLevel = normalizeListboardGradeLevel(input.grade_level)

  if (examYear !== null && (!Number.isInteger(examYear) || examYear < 2000 || examYear > 2100)) {
    throw new Error('년도는 2000~2100 범위의 숫자로 입력해주세요.')
  }

  if (examMonth !== null && (!Number.isInteger(examMonth) || examMonth < 1 || examMonth > 12)) {
    throw new Error('월은 1~12 범위에서 선택해주세요.')
  }

  if (input.grade_level && !gradeLevel) {
    throw new Error(`학년은 ${LISTBOARD_GRADE_OPTIONS.join(', ')} 중에서 선택해주세요.`)
  }

  return {
    examYear,
    examMonth,
    gradeLevel,
  }
}

export function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

function buildSearchConfig(entryType: 'personal_generate' | 'listboard', slug: string) {
  if (entryType === 'personal_generate') {
    return { entryHref: '/generate/personal' }
  }

  if (slug === 'mock-exams') {
    return {
      filters: ['year', 'month', 'grade', 'title'],
      entryHref: buildGenerateMenuHref({ entry_type: entryType, slug }),
    }
  }

  return {
    filters: ['title'],
    entryHref: buildGenerateMenuHref({ entry_type: entryType, slug }),
  }
}

function getMappedLegacyKey(child: Pick<HeaderMenuChildItem, 'title' | 'href'>) {
  const normalizedHref = child.href.replace(/^\//, '')

  if (child.title === '개인지문' || child.href === '/personal') {
    return {
      entryKey: 'personal',
      slug: 'personal',
      entryType: 'personal_generate' as const,
    }
  }

  if (child.title === '모의고사' || child.href === '/exam') {
    return {
      entryKey: 'mock-exams',
      slug: 'mock-exams',
      entryType: 'listboard' as const,
    }
  }

  const slug = normalizeSlug(normalizedHref || child.title)
  return {
    entryKey: slug,
    slug,
    entryType: 'listboard' as const,
  }
}

function validateEntryInput(input: {
  title?: string
  slug?: string
  entry_type?: string
}): {
  title: string
  slug: string
  entryType: 'personal_generate' | 'listboard'
} {
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

async function assertListboardEntry(menuEntryId: string) {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .eq('id', menuEntryId)
    .single()

  if (error || !data) {
    throw new Error('문제생성 메뉴를 찾을 수 없습니다.')
  }

  if (data.entry_type !== 'listboard') {
    throw new Error('리스트보드 게시글은 listboard 메뉴에만 연결할 수 있습니다.')
  }

  return data
}

async function assertGenerateListboardPost(postId: string) {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('generate_listboard_posts')
    .select('*')
    .eq('id', postId)
    .is('deleted_at', null)
    .single()

  if (error || !data) {
    throw new Error('게시글을 찾을 수 없습니다.')
  }

  await assertListboardEntry(data.menu_entry_id)
  return data
}

function normalizeGenerateListboardPostItemError(error: { message: string }) {
  if (error.message.includes('uq_generate_listboard_post_items_post_question_number_active')) {
    return new Error('같은 게시글 안에는 동일한 문항 번호를 중복 저장할 수 없습니다.')
  }

  return new Error(error.message)
}

function buildGenerateListboardPostItemPayload(
  current: Pick<GenerateListboardPostItem, 'question_number' | 'passage_text' | 'sort_order' | 'is_active' | 'post_id' | 'updated_by' | 'created_by'> | null,
  input: Pick<TablesInsert<'generate_listboard_post_items'>, 'post_id' | 'question_number' | 'passage_text' | 'sort_order' | 'is_active' | 'created_by' | 'updated_by'>
) {
  const questionNumber = normalizeQuestionNumber(input.question_number ?? current?.question_number)
  const passageText = normalizeText(input.passage_text ?? current?.passage_text)

  if (!input.post_id && !current?.post_id) {
    throw new Error('게시글 정보가 없습니다.')
  }

  if (!questionNumber) {
    throw new Error('문항 번호를 입력해주세요.')
  }

  if (!passageText) {
    throw new Error('지문 내용을 입력해주세요.')
  }

  return {
    post_id: input.post_id ?? current?.post_id ?? '',
    question_number: questionNumber,
    passage_text: passageText,
    sort_order: input.sort_order ?? current?.sort_order ?? 0,
    is_active: input.is_active ?? current?.is_active ?? true,
    created_by: input.created_by ?? current?.created_by ?? null,
    updated_by: input.updated_by ?? current?.updated_by ?? null,
  }
}

async function syncGenerateListboardPostRepresentativePassage(postId: string) {
  const supabase = getAdminSupabase()
  let { data: representativeItem, error: itemError } = await supabase
    .from('generate_listboard_post_items')
    .select('passage_text')
    .eq('post_id', postId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('sort_order')
    .order('created_at')
    .limit(1)
    .maybeSingle()

  if (itemError) {
    throw new Error(itemError.message)
  }

  if (!representativeItem) {
    const fallbackResponse = await supabase
      .from('generate_listboard_post_items')
      .select('passage_text')
      .eq('post_id', postId)
      .is('deleted_at', null)
      .order('sort_order')
      .order('created_at')
      .limit(1)
      .maybeSingle()

    representativeItem = fallbackResponse.data
    itemError = fallbackResponse.error
  }

  if (itemError) {
    throw new Error(itemError.message)
  }

  const nextPassageText = normalizeText(representativeItem?.passage_text)

  if (!nextPassageText) {
    return
  }

  const { error: postError } = await supabase
    .from('generate_listboard_posts')
    .update({ passage_text: nextPassageText })
    .eq('id', postId)

  if (postError) {
    throw new Error(postError.message)
  }
}

function validateGenerateListboardPostItems(
  items: Array<Pick<TablesInsert<'generate_listboard_post_items'>, 'question_number' | 'passage_text' | 'sort_order' | 'is_active'>>
) {
  if (items.length === 0) {
    throw new Error('최소 1개 이상의 문항이 필요합니다.')
  }

  const normalizedItems = items.map((item, index) => {
    const questionNumber = normalizeQuestionNumber(item.question_number)
    const passageText = normalizeText(item.passage_text)

    if (!questionNumber) {
      throw new Error(`${index + 1}번째 문항의 번호를 입력해주세요.`)
    }

    if (!passageText) {
      throw new Error(`${index + 1}번째 문항의 지문 내용을 입력해주세요.`)
    }

    return {
      question_number: questionNumber,
      passage_text: passageText,
      sort_order: item.sort_order ?? (index + 1) * 10,
      is_active: item.is_active ?? true,
    }
  })

  const duplicateQuestionNumber = normalizedItems.find((item, index) => (
    normalizedItems.findIndex((candidate) => candidate.question_number === item.question_number) !== index
  ))

  if (duplicateQuestionNumber) {
    throw new Error(`문항 번호 "${duplicateQuestionNumber.question_number}"가 중복되었습니다.`)
  }

  return normalizedItems
}

export function getGenerateChildrenSourceMode() {
  return GENERATE_CHILDREN_SOURCE_MODE
}

export function getLegacyGenerateChildren(baseConfig: HeaderNavigationConfig, existingEntries: GenerateMenuEntry[]): LegacyGenerateChildSummary[] {
  const generateParent = baseConfig.items.find((item) => item.href === '/generate')
  const children = generateParent?.children ?? []
  const existingKeys = new Set(existingEntries.map((entry) => entry.entry_key))

  return children.map((child) => {
    const mapped = getMappedLegacyKey(child)
    return {
      id: child.id,
      title: child.title,
      href: child.href,
      isActive: child.isActive,
      entryKey: mapped.entryKey,
      slug: mapped.slug,
      entryType: mapped.entryType,
      existsInDb: existingKeys.has(mapped.entryKey),
    }
  })
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

export async function listGenerateListboardPostsForAdmin(menuEntryId: string): Promise<GenerateListboardPost[]> {
  await assertListboardEntry(menuEntryId)
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('generate_listboard_posts')
    .select('*')
    .eq('menu_entry_id', menuEntryId)
    .is('deleted_at', null)
    .order('exam_year', { ascending: false, nullsFirst: false })
    .order('exam_month', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

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

export async function getGenerateMenuEntriesBackfillStatus(baseConfig?: HeaderNavigationConfig) {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .is('deleted_at', null)

  if (error) {
    throw new Error(error.message)
  }

  const entries = data ?? []
  const legacyChildren = baseConfig ? getLegacyGenerateChildren(baseConfig, entries) : []

  return {
    sourceMode: getGenerateChildrenSourceMode(),
    entryCount: entries.length,
    missingLegacyChildren: legacyChildren.filter((child) => !child.existsInDb),
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
    search_config: input.search_config ?? buildSearchConfig(normalized.entryType, slug),
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
    search_config: input.search_config ?? current.search_config ?? buildSearchConfig(current.entry_type as 'personal_generate' | 'listboard', nextSlug),
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

export async function backfillGenerateMenuEntriesFromHeader(baseConfig: HeaderNavigationConfig) {
  const supabase = getAdminSupabase()
  const { data: existingEntries, error: existingError } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .is('deleted_at', null)

  if (existingError) {
    throw new Error(existingError.message)
  }

  const legacyChildren = getLegacyGenerateChildren(baseConfig, existingEntries ?? [])
  const results: GenerateMenuEntry[] = []

  for (const [index, child] of legacyChildren.entries()) {
    const payload: TablesInsert<'generate_menu_entries'> = {
      entry_key: child.entryKey,
      slug: child.slug,
      title: child.title,
      entry_type: child.entryType,
      description: child.entryType === 'personal_generate' ? '기존 개인지문 AI 문제생성 진입점' : `${child.title} 리스트보드 진입점`,
      sort_order: (index + 1) * 10,
      is_visible: child.isActive,
      is_active: child.isActive,
      search_config: buildSearchConfig(child.entryType, child.slug),
    }

    const { data, error } = await supabase
      .from('generate_menu_entries')
      .upsert(payload, { onConflict: 'entry_key' })
      .select('*')
      .single()

    if (error) {
      throw new Error(error.message)
    }

    results.push(data)
  }

  return results
}

export async function createGenerateListboardPost(
  input: Pick<TablesInsert<'generate_listboard_posts'>, 'menu_entry_id' | 'title' | 'passage_text' | 'exam_year' | 'exam_month' | 'grade_level' | 'status' | 'is_active' | 'published_at' | 'created_by' | 'updated_by'>
) {
  await assertListboardEntry(input.menu_entry_id)
  const supabase = getAdminSupabase()
  const title = normalizeText(input.title)
  const passageText = normalizeText(input.passage_text)
  const metadata = validateListboardExamMetadata(input)

  if (!title) {
    throw new Error('게시글 제목을 입력해주세요.')
  }

  if (!passageText) {
    throw new Error('지문 내용을 입력해주세요.')
  }

  const payload: TablesInsert<'generate_listboard_posts'> = {
    menu_entry_id: input.menu_entry_id,
    title,
    passage_text: passageText,
    exam_year: metadata.examYear,
    exam_month: metadata.examMonth,
    grade_level: metadata.gradeLevel,
    status: input.status ?? 'draft',
    is_active: input.is_active ?? true,
    published_at: input.status === 'published' ? (input.published_at ?? new Date().toISOString()) : null,
    created_by: input.created_by ?? null,
    updated_by: input.updated_by ?? null,
  }

  const { data, error } = await supabase
    .from('generate_listboard_posts')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function createGenerateListboardPostWithItems(
  input: Pick<TablesInsert<'generate_listboard_posts'>, 'menu_entry_id' | 'title' | 'exam_year' | 'exam_month' | 'grade_level' | 'status' | 'is_active' | 'published_at' | 'created_by' | 'updated_by'>,
  items: Array<Pick<TablesInsert<'generate_listboard_post_items'>, 'question_number' | 'passage_text' | 'sort_order' | 'is_active'>>
) {
  const normalizedItems = validateGenerateListboardPostItems(items)
  const seedPassageText = normalizedItems[0]?.passage_text ?? ''
  const supabase = getAdminSupabase()

  const post = await createGenerateListboardPost({
    ...input,
    passage_text: seedPassageText,
  })

  try {
    const itemPayloads: TablesInsert<'generate_listboard_post_items'>[] = normalizedItems.map((item) => ({
      post_id: post.id,
      question_number: item.question_number,
      passage_text: item.passage_text,
      sort_order: item.sort_order,
      is_active: item.is_active,
      created_by: input.created_by ?? null,
      updated_by: input.updated_by ?? null,
    }))

    const { data, error } = await supabase
      .from('generate_listboard_post_items')
      .insert(itemPayloads)
      .select('*')

    if (error) {
      throw normalizeGenerateListboardPostItemError(error)
    }

    return {
      post,
      items: data ?? [],
    }
  } catch (error) {
    await supabase
      .from('generate_listboard_posts')
      .delete()
      .eq('id', post.id)

    throw error
  }
}

export async function updateGenerateListboardPost(
  id: string,
  input: Pick<TablesUpdate<'generate_listboard_posts'>, 'title' | 'passage_text' | 'exam_year' | 'exam_month' | 'grade_level' | 'status' | 'is_active' | 'published_at' | 'updated_by'>
) {
  const supabase = getAdminSupabase()
  const { data: current, error: currentError } = await supabase
    .from('generate_listboard_posts')
    .select('*')
    .eq('id', id)
    .single()

  if (currentError || !current) {
    throw new Error('수정할 게시글을 찾을 수 없습니다.')
  }

  const metadata = validateListboardExamMetadata({
    exam_year: input.exam_year ?? current.exam_year,
    exam_month: input.exam_month ?? current.exam_month,
    grade_level: input.grade_level ?? current.grade_level,
  })

  const payload: TablesUpdate<'generate_listboard_posts'> = {
    title: normalizeText(input.title ?? current.title),
    passage_text: normalizeText(input.passage_text ?? current.passage_text),
    exam_year: metadata.examYear,
    exam_month: metadata.examMonth,
    grade_level: metadata.gradeLevel,
    status: input.status ?? current.status,
    is_active: input.is_active ?? current.is_active,
    published_at: (input.status ?? current.status) === 'published'
      ? (input.published_at ?? current.published_at ?? new Date().toISOString())
      : null,
    updated_by: input.updated_by ?? current.updated_by,
  }

  const { data, error } = await supabase
    .from('generate_listboard_posts')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function listGenerateListboardPostItemsForAdmin(postId: string): Promise<GenerateListboardPostItem[]> {
  await assertGenerateListboardPost(postId)
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('generate_listboard_post_items')
    .select('*')
    .eq('post_id', postId)
    .is('deleted_at', null)
    .order('sort_order')
    .order('created_at')

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function createGenerateListboardPostItem(
  input: Pick<TablesInsert<'generate_listboard_post_items'>, 'post_id' | 'question_number' | 'passage_text' | 'sort_order' | 'is_active' | 'created_by' | 'updated_by'>
) {
  await assertGenerateListboardPost(input.post_id)
  const supabase = getAdminSupabase()
  const payload = buildGenerateListboardPostItemPayload(null, input)

  const { data, error } = await supabase
    .from('generate_listboard_post_items')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw normalizeGenerateListboardPostItemError(error)
  }

  await syncGenerateListboardPostRepresentativePassage(input.post_id)

  return data
}

export async function updateGenerateListboardPostItem(
  id: string,
  input: Pick<TablesUpdate<'generate_listboard_post_items'>, 'question_number' | 'passage_text' | 'sort_order' | 'is_active' | 'updated_by'>
) {
  const supabase = getAdminSupabase()
  const { data: current, error: currentError } = await supabase
    .from('generate_listboard_post_items')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (currentError || !current) {
    throw new Error('수정할 문항을 찾을 수 없습니다.')
  }

  await assertGenerateListboardPost(current.post_id)
  const payload = buildGenerateListboardPostItemPayload(current, {
    post_id: current.post_id,
    question_number: input.question_number ?? current.question_number,
    passage_text: input.passage_text ?? current.passage_text,
    sort_order: input.sort_order ?? current.sort_order,
    is_active: input.is_active ?? current.is_active,
    created_by: current.created_by,
    updated_by: input.updated_by ?? current.updated_by,
  })

  const { data, error } = await supabase
    .from('generate_listboard_post_items')
    .update({
      question_number: payload.question_number,
      passage_text: payload.passage_text,
      sort_order: payload.sort_order,
      is_active: payload.is_active,
      updated_by: payload.updated_by,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw normalizeGenerateListboardPostItemError(error)
  }

  await syncGenerateListboardPostRepresentativePassage(current.post_id)

  return data
}

export async function archiveGenerateListboardPostItem(id: string) {
  const supabase = getAdminSupabase()
  const { data: current, error: currentError } = await supabase
    .from('generate_listboard_post_items')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (currentError || !current) {
    throw new Error('보관할 문항을 찾을 수 없습니다.')
  }

  const { count, error: countError } = await supabase
    .from('generate_listboard_post_items')
    .select('id', { count: 'exact', head: true })
    .eq('post_id', current.post_id)
    .is('deleted_at', null)

  if (countError) {
    throw new Error(countError.message)
  }

  if ((count ?? 0) <= 1) {
    throw new Error('마지막 문항은 보관할 수 없습니다. 최소 1개 문항은 유지해주세요.')
  }

  const { error } = await supabase
    .from('generate_listboard_post_items')
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }

  await syncGenerateListboardPostRepresentativePassage(current.post_id)
}

export async function archiveGenerateListboardPost(id: string) {
  const supabase = getAdminSupabase()
  const { error } = await supabase
    .from('generate_listboard_posts')
    .update({
      status: 'archived',
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}

export function getGenerateMenuPreviewPath(entry: Pick<GenerateMenuEntry, 'entry_type' | 'slug'>) {
  return buildGenerateMenuHref(entry)
}
