import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET: 모든 Provider 목록 조회
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const includeInactive = searchParams.get('includeInactive') === 'true'

    let query = supabase
      .from('providers')
      .select('*')
      .order('display_order', { ascending: true })

    if (!includeInactive) {
      query = query.eq('is_active', true)
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

// POST: 새 Provider 생성
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
    const { name, display_name, display_order, is_active } = body

    if (!name || !display_name) {
      return NextResponse.json({ error: 'Name and display_name are required' }, { status: 400 })
    }

    // 같은 name이 이미 있는지 확인
    const { data: existing } = await supabase
      .from('providers')
      .select('id')
      .eq('name', name)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Provider with this name already exists' }, { status: 400 })
    }

    // 최대 display_order 찾기
    let order = display_order
    if (order === undefined || order === null) {
      const { data: maxProviders, error: maxError } = await supabase
        .from('providers')
        .select('display_order')
        .order('display_order', { ascending: false })
        .limit(1)
      
      if (maxError && maxError.code !== 'PGRST116') {
        return NextResponse.json({ error: maxError.message }, { status: 500 })
      }
      
      order = maxProviders && maxProviders.length > 0 ? maxProviders[0].display_order + 1 : 1
    }

    const { data, error } = await supabase
      .from('providers')
      .insert({
        name,
        display_name,
        display_order: order,
        is_active: is_active !== undefined ? is_active : true
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

// PUT: Provider 업데이트
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
    const { id, name, display_name, display_order, is_active } = body

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    }

    if (name !== undefined) updateData.name = name
    if (display_name !== undefined) updateData.display_name = display_name
    if (display_order !== undefined) updateData.display_order = display_order
    if (is_active !== undefined) updateData.is_active = is_active

    const { data, error } = await supabase
      .from('providers')
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

// DELETE: Provider 삭제
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

    // 해당 provider를 사용하는 ai_models가 있는지 확인
    const { data: provider } = await supabase
      .from('providers')
      .select('name')
      .eq('id', id)
      .single()

    if (provider) {
      const { data: modelsUsingProvider } = await supabase
        .from('ai_models')
        .select('id')
        .eq('provider', provider.name)
        .limit(1)

      if (modelsUsingProvider && modelsUsingProvider.length > 0) {
        return NextResponse.json({ 
          error: 'Cannot delete provider: There are AI models using this provider' 
        }, { status: 400 })
      }
    }

    const { error } = await supabase
      .from('providers')
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
