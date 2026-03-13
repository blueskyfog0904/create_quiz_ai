import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/supabase'

type GenerateMenuEntry = Database['public']['Tables']['generate_menu_entries']['Row']
type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']
type ProblemType = Database['public']['Tables']['problem_types']['Row']

export interface ListboardSearchFilters {
  year?: string
  month?: string
  grade?: string
  title?: string
}

export async function getGenerateBoardBySlug(slug: string): Promise<GenerateMenuEntry | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('generate_menu_entries')
    .select('*')
    .eq('slug', slug)
    .eq('entry_type', 'listboard')
    .eq('is_visible', true)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function searchGenerateBoardPosts(boardId: string, filters: ListboardSearchFilters) {
  const supabase = await createClient()
  let query = supabase
    .from('generate_listboard_posts')
    .select('*')
    .eq('menu_entry_id', boardId)
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

  return data ?? []
}

export async function getGenerateBoardFilterOptions(boardId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('generate_listboard_posts')
    .select('exam_year, exam_month, grade_level')
    .eq('menu_entry_id', boardId)
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

export async function getGenerateBoardPost(boardId: string, postId: string): Promise<GenerateListboardPost | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('generate_listboard_posts')
    .select('*')
    .eq('menu_entry_id', boardId)
    .eq('id', postId)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function getActiveProblemTypes(): Promise<ProblemType[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('problem_types')
    .select('*')
    .eq('is_active', true)
    .neq('model_name', 'admin')
    .order('type_name')

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}
