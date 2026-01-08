import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET: 모든 AI 모델 목록 조회
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider')

    let query = supabase
      .from('ai_models')
      .select('*')
      .order('display_order', { ascending: true })

    if (provider) {
      query = query.eq('provider', provider)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: 새 AI 모델 생성
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    // Admin 체크
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

    const body = await request.json()
    const { name, provider, display_order } = body

    if (!name || !provider) {
      return NextResponse.json({ error: 'Name and provider are required' }, { status: 400 })
    }

    // 같은 provider에서 최대 display_order 찾기
    let order = display_order
    if (order === undefined || order === null) {
      const { data: maxModels, error: maxError } = await supabase
        .from('ai_models')
        .select('display_order')
        .eq('provider', provider)
        .order('display_order', { ascending: false })
        .limit(1)
      
      if (maxError && maxError.code !== 'PGRST116') { // PGRST116은 "no rows returned" 에러
        return NextResponse.json({ error: maxError.message }, { status: 500 })
      }
      
      order = maxModels && maxModels.length > 0 ? maxModels[0].display_order + 1 : 1
    }

    const { data, error } = await supabase
      .from('ai_models')
      .insert({
        name,
        provider,
        display_order: order
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PUT: AI 모델 업데이트
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    
    // Admin 체크
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

    const body = await request.json()
    const { id, name, provider, display_order } = body

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    }

    if (name !== undefined) updateData.name = name
    if (provider !== undefined) updateData.provider = provider
    if (display_order !== undefined) updateData.display_order = display_order

    const { data, error } = await supabase
      .from('ai_models')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE: AI 모델 삭제
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    
    // Admin 체크
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

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('ai_models')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
