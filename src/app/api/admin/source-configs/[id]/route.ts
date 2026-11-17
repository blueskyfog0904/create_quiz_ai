import { createClient } from '@/lib/supabase/server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import type { Database } from '@/types/supabase'

const configSchema = z.object({
  workspace_subject: z.enum(['english', 'korean']).optional(),
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
    // 꺼 둔 기능의 API다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 쓴다.
    const guard = await requireAdminApiPermission('owner')
    if ('error' in guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const body = await request.json()
    const validatedData = configSchema.parse(body)

    // Update config
    const workspaceSubject = resolveAdminWorkspaceSubject(validatedData.workspace_subject ?? new URL(request.url).searchParams.get('subject'))
    const { data, error } = await supabase
      .from('source_configs')
      .update({
        ...validatedData,
        workspace_subject: workspaceSubject,
      } as Database['public']['Tables']['source_configs']['Update'] & { workspace_subject: WorkspaceSubject })
      .eq('id', params.id)
      .eq('workspace_subject', workspaceSubject)
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
    // 꺼 둔 기능의 API다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 쓴다.
    const guard = await requireAdminApiPermission('owner')
    if ('error' in guard) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    // Delete config
    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const { error } = await supabase
      .from('source_configs')
      .delete()
      .eq('id', params.id)
      .eq('workspace_subject', workspaceSubject)

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
