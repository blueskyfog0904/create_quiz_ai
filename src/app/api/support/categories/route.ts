import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('support_ticket_categories')
      .select('id, slug, name, description, help_text, guide_items, subject_placeholder, message_placeholder, sort_order, is_active, deleted_at')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json({ categories: data || [] })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '문의 카테고리 조회에 실패했습니다.',
    }, { status: 500 })
  }
}
