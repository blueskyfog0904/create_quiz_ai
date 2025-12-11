import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check admin authentication
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search') || ''
    const gradeLevel = searchParams.get('grade_level') || ''
    const difficulty = searchParams.get('difficulty') || ''
    const problemTypeId = searchParams.get('problem_type_id') || ''
    const sortBy = searchParams.get('sort_by') || 'created_at'
    const sortOrder = searchParams.get('sort_order') || 'desc'

    const offset = (page - 1) * limit

    // Build query
    let query = supabase
      .from('questions')
      .select(`
        id,
        question_text,
        question_text_forward,
        question_text_backward,
        choices,
        answer,
        explanation,
        passage_text,
        grade_level,
        difficulty,
        source,
        created_at,
        updated_at,
        problem_type_id,
        problem_types (type_name),
        profiles:user_id (id, name, email)
      `, { count: 'exact' })

    // Only show admin uploaded questions (exclude ai_generated)
    query = query.eq('source', 'admin_uploaded')

    // Apply filters
    if (search) {
      query = query.or(`question_text.ilike.%${search}%,passage_text.ilike.%${search}%`)
    }
    if (gradeLevel) {
      query = query.eq('grade_level', gradeLevel)
    }
    if (difficulty) {
      query = query.eq('difficulty', difficulty)
    }
    if (problemTypeId) {
      query = query.eq('problem_type_id', problemTypeId)
    }

    // Apply sorting
    query = query.order(sortBy, { ascending: sortOrder === 'asc' })

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: questions, error, count } = await query

    if (error) {
      console.error('Error fetching questions:', error)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    return NextResponse.json({
      questions: questions || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    })
  } catch (error) {
    console.error('Error in admin questions route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

