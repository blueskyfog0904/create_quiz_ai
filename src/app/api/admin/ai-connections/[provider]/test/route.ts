import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { testProviderConnection } from '@/lib/ai/provider-connections'

export const dynamic = 'force-dynamic'

const ProviderSchema = z.enum(['openai', 'gemini', 'claude'])

// 꺼 둔 기능의 API다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 쓴다.
async function requireAdmin() {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return { error: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  }
  return { userId: guard.access.userId }
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
