import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { testProviderConnection } from '@/lib/ai/provider-connections'

export const dynamic = 'force-dynamic'

const ProviderSchema = z.enum(['openai', 'gemini', 'claude'])

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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  const resolvedParams = await params
  const providerValidation = ProviderSchema.safeParse(resolvedParams.provider)
  if (!providerValidation.success) {
    return NextResponse.json({ error: 'Unsupported AI provider' }, { status: 400 })
  }

  const result = await testProviderConnection(providerValidation.data)
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}
