import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { PROMPT_DEFAULT_KEYS } from '@/lib/ai/problem-type-default-prompts'

const defaultPromptSchema = z.object({
  prompt_key: z.enum([
    'output_format',
    'review_prompt_template',
    'review_output_format',
    'regeneration_prompt_template',
  ]),
  content: z.string().refine((content) => content.trim().length > 0, {
    message: '기본 프롬프트 내용은 비워둘 수 없습니다.',
  }),
  is_enabled: z.boolean(),
})

const updateDefaultPromptsSchema = z.object({
  prompts: z.array(defaultPromptSchema),
})

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { supabase, error: NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 }) }
  }

  return { supabase, error: null }
}

export async function GET(request: Request) {
  try {
    const { supabase, error: authError } = await requireAdmin()
    if (authError) return authError

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const { data, error } = await supabase
      .from('problem_type_default_prompts')
      .select('*')
      .eq('workspace_subject', workspaceSubject)
      .order('sort_order', { ascending: true })

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch default prompts' }, { status: 500 })
    }

    return NextResponse.json({ prompts: data || [] })
  } catch (error) {
    console.error('[Admin Problem Type Default Prompts] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, error: authError } = await requireAdmin()
    if (authError) return authError

    const workspaceSubject = resolveAdminWorkspaceSubject(new URL(request.url).searchParams.get('subject'))
    const body = await request.json()
    const validated = updateDefaultPromptsSchema.parse(body)
    const rows = validated.prompts.map((prompt) => {
      const meta = PROMPT_DEFAULT_KEYS.find((item) => item.key === prompt.prompt_key)

      return {
        workspace_subject: workspaceSubject,
        prompt_key: prompt.prompt_key,
        display_name: meta?.displayName || prompt.prompt_key,
        description: meta?.description || null,
        content: prompt.content.trim(),
        is_enabled: prompt.is_enabled,
        sort_order: meta?.sortOrder || 0,
        updated_at: new Date().toISOString(),
      }
    })

    const { data, error } = await supabase
      .from('problem_type_default_prompts')
      .upsert(rows, { onConflict: 'workspace_subject,prompt_key' })
      .select()

    if (error) {
      return NextResponse.json({ error: 'Failed to update default prompts' }, { status: 500 })
    }

    return NextResponse.json({ success: true, prompts: data || [] })
  } catch (error) {
    console.error('[Admin Problem Type Default Prompts] PATCH error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
