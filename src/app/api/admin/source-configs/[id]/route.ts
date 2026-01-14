import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const configSchema = z.object({
  type_name: z.string().min(1, '출처 종류 이름은 필수입니다'),
  source_1_label: z.string().optional().nullable(),
  source_1_options: z.array(z.string()).optional().nullable(),
  source_2_label: z.string().optional().nullable(),
  source_2_options: z.array(z.string()).optional().nullable(),
  source_3_label: z.string().optional().nullable(),
  source_3_options: z.array(z.string()).optional().nullable(),
  source_4_label: z.string().optional().nullable(),
  source_4_options: z.array(z.string()).optional().nullable(),
})

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params
  try {
    const supabase = await createClient()
    
    // Check authentication and admin status
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validatedData = configSchema.parse(body)

    // Update config
    const { data, error } = await supabase
      .from('source_configs')
      .update(validatedData)
      .eq('id', params.id)
      .select()
      .single()

    if (error) {
      console.error('Error updating source config:', error)
      if (error.code === '23505') { // Unique violation
        return NextResponse.json(
          { error: '이미 존재하는 출처 종류입니다.' },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: 'Failed to update source config' },
        { status: 500 }
      )
    }

    return NextResponse.json({ config: data })
  } catch (error) {
    console.error('Internal server error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params
  try {
    const supabase = await createClient()
    
    // Check authentication and admin status
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Delete config
    const { error } = await supabase
      .from('source_configs')
      .delete()
      .eq('id', params.id)

    if (error) {
      console.error('Error deleting source config:', error)
      return NextResponse.json(
        { error: 'Failed to delete source config' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Internal server error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
