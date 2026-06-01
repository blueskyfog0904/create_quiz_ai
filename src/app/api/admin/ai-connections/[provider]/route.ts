import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { saveProviderConnection } from '@/lib/ai/provider-connections'

export const dynamic = 'force-dynamic'

const ProviderSchema = z.enum(['openai', 'gemini', 'claude'])

const ConnectionUpdateSchema = z.object({
  displayName: z.string().optional(),
  isEnabled: z.boolean().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  anthropicVersion: z.string().nullable().optional(),
})

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  const resolvedParams = await params
  const providerValidation = ProviderSchema.safeParse(resolvedParams.provider)
  if (!providerValidation.success) {
    return NextResponse.json({ error: 'Unsupported AI provider' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  const validation = ConnectionUpdateSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message || 'Invalid input' }, { status: 400 })
  }

  try {
    const connection = await saveProviderConnection({
      provider: providerValidation.data,
      ...validation.data,
    })
    return NextResponse.json({ data: connection })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to save AI provider connection',
    }, { status: 500 })
  }
}
