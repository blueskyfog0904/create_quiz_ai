import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_WORKSPACE_SUBJECT,
  isWorkspaceSubject,
  type WorkspaceSubject,
} from '@/lib/workspace-subject'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type QuestionBankYearRow = {
  id: string
  year: number
  label: string
  sort_order: number
  is_active: boolean
}

type QuestionBankBookRow = {
  id: string
  name: string
  slug: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type QuestionBankProblemTypeRow = {
  id: string
  type_name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

function resolveRequestedWorkspaceSubject(searchParams: URLSearchParams): WorkspaceSubject | null {
  const requestedSubject = searchParams.get('workspaceSubject') ?? searchParams.get('subject')

  if (!requestedSubject) {
    return DEFAULT_WORKSPACE_SUBJECT
  }

  return isWorkspaceSubject(requestedSubject) ? requestedSubject : null
}

function mapYear(row: QuestionBankYearRow) {
  return {
    id: row.id,
    year: row.year,
    label: row.label,
    sort: row.sort_order,
    isActive: row.is_active,
  }
}

function mapBook(row: QuestionBankBookRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sort: row.sort_order,
    isActive: row.is_active,
  }
}

function mapProblemType(row: QuestionBankProblemTypeRow) {
  return {
    id: row.id,
    type_name: row.type_name,
    description: row.description,
    sort: row.sort_order,
    is_active: row.is_active,
    isActive: row.is_active,
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceSubject = resolveRequestedWorkspaceSubject(new URL(request.url).searchParams)

    if (!workspaceSubject) {
      return NextResponse.json({ error: 'Unsupported workspace subject' }, { status: 400 })
    }

    const [yearsResult, booksResult, problemTypesResult] = await Promise.all([
      supabase
        .from('question_bank_years')
        .select('id, year, label, sort_order, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('question_bank_books')
        .select('id, name, slug, description, sort_order, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('question_bank_problem_types')
        .select('id, type_name, description, sort_order, is_active')
        .eq('workspace_subject', workspaceSubject)
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ])

    if (yearsResult.error || booksResult.error || problemTypesResult.error) {
      console.error('[Question Bank Options] Failed to fetch dimensions:', yearsResult.error ?? booksResult.error ?? problemTypesResult.error)
      return NextResponse.json({ error: 'Failed to fetch question bank options' }, { status: 500 })
    }

    const years = (yearsResult.data ?? []).map(mapYear)
    const books = (booksResult.data ?? []).map(mapBook)
    const problemTypes = (problemTypesResult.data ?? []).map(mapProblemType)

    return NextResponse.json({ years, books, problemTypes })
  } catch (error) {
    console.error('[Question Bank Options] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
