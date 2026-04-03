import { createAdminClient } from '@/lib/supabase/bypass'
import type { Database } from '@/types/supabase'
import {
  DEFAULT_GENERATE_WORKSPACE_SUBJECT,
  type WorkspaceScoped,
  type WorkspaceSubject,
} from '../workspace-subject'

type GenerateMenuEntry = WorkspaceScoped<Database['public']['Tables']['generate_menu_entries']['Row']>
type GenerateListboardPost = WorkspaceScoped<Database['public']['Tables']['generate_listboard_posts']['Row']>
type GenerateListboardPostItem = WorkspaceScoped<Database['public']['Tables']['generate_listboard_post_items']['Row']>
type ProblemType = WorkspaceScoped<Database['public']['Tables']['problem_types']['Row']>

export interface ListboardSearchFilters {
  year?: string
  month?: string
  grade?: string
  title?: string
}

function withWorkspaceSubject<T extends Record<string, unknown>>(
  row: T | null,
  workspaceSubject: WorkspaceSubject
): (T & { workspace_subject: WorkspaceSubject }) | null {
  return row ? { ...row, workspace_subject: workspaceSubject } : null
}

function withWorkspaceSubjects<T extends Record<string, unknown>>(
  rows: T[] | null | undefined,
  workspaceSubject: WorkspaceSubject
): Array<T & { workspace_subject: WorkspaceSubject }> {
  return (rows ?? []).map((row) => ({
    ...row,
    workspace_subject: workspaceSubject,
  }))
}

export async function getGenerateBoardBySlug(
  slug: string,
  workspaceSubject: WorkspaceSubject = DEFAULT_GENERATE_WORKSPACE_SUBJECT
): Promise<GenerateMenuEntry | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .eq('slug', slug)
    .eq('workspace_subject', workspaceSubject)
    .eq('entry_type', 'listboard')
    .eq('is_visible', true)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data, workspaceSubject)
}

export async function searchGenerateBoardPosts(
  boardId: string,
  filters: ListboardSearchFilters,
  workspaceSubject: WorkspaceSubject = DEFAULT_GENERATE_WORKSPACE_SUBJECT
) {
  const supabase = createAdminClient()
  let query = supabase
    .from('generate_listboard_posts')
    .select('*')
    .eq('menu_entry_id', boardId)
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('exam_year', { ascending: false, nullsFirst: false })
    .order('exam_month', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  if (filters.year) {
    query = query.eq('exam_year', Number(filters.year))
  }

  if (filters.month) {
    query = query.eq('exam_month', Number(filters.month))
  }

  if (filters.grade) {
    query = query.eq('grade_level', filters.grade)
  }

  if (filters.title) {
    query = query.ilike('title', `%${filters.title}%`)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data, workspaceSubject)
}

export async function getGenerateBoardFilterOptions(
  boardId: string,
  workspaceSubject: WorkspaceSubject = DEFAULT_GENERATE_WORKSPACE_SUBJECT
) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('generate_listboard_posts')
    .select('exam_year, exam_month, grade_level')
    .eq('menu_entry_id', boardId)
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error) {
    throw new Error(error.message)
  }

  const years = Array.from(new Set((data ?? []).map((item) => item.exam_year).filter((value): value is number => value !== null))).sort((a, b) => b - a)
  const months = Array.from(new Set((data ?? []).map((item) => item.exam_month).filter((value): value is number => value !== null))).sort((a, b) => a - b)
  const grades = Array.from(new Set((data ?? []).map((item) => item.grade_level).filter((value): value is string => !!value))).sort((a, b) => a.localeCompare(b, 'ko'))

  return { years, months, grades }
}

export async function getGenerateBoardPost(
  boardId: string,
  postId: string,
  workspaceSubject: WorkspaceSubject = DEFAULT_GENERATE_WORKSPACE_SUBJECT
): Promise<GenerateListboardPost | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('generate_listboard_posts')
    .select('*')
    .eq('menu_entry_id', boardId)
    .eq('id', postId)
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data, workspaceSubject)
}

export async function getGenerateBoardPostWithItems(
  boardId: string,
  postId: string,
  workspaceSubject: WorkspaceSubject = DEFAULT_GENERATE_WORKSPACE_SUBJECT
): Promise<{
  post: GenerateListboardPost
  items: GenerateListboardPostItem[]
} | null> {
  const post = await getGenerateBoardPost(boardId, postId, workspaceSubject)

  if (!post) {
    return null
  }

  const supabase = createAdminClient()
  const { data: items, error } = await supabase
    .from('generate_listboard_post_items')
    .select('*')
    .eq('post_id', post.id)
    .eq('workspace_subject', workspaceSubject)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('sort_order')
    .order('created_at')

  if (error) {
    throw new Error(error.message)
  }

  return {
    post,
    items: withWorkspaceSubjects(items, workspaceSubject),
  }
}

export async function getActiveProblemTypes(
  workspaceSubject: WorkspaceSubject = DEFAULT_GENERATE_WORKSPACE_SUBJECT
): Promise<ProblemType[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('problem_types')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .eq('is_active', true)
    .neq('model_name', 'admin')
    .order('type_name')

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data, workspaceSubject)
}
