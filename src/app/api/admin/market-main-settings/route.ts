import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import type { AdminPermissionRequirement } from '@/lib/admin-permissions'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import {
  MARKET_HOME_CACHE_TAG,
  MARKET_HOME_SETTING_KEY,
  diffMarketHomeSections,
  validateMarketHomeDraft,
  type MarketHomeDraft,
} from '@/lib/market-home'
import { MarketHomeRevisionConflictError, saveMarketHomeConfig } from '@/lib/market-home-server'
import { MEMBER_FACING_PII_LABELS, memberFacingTextPiiHits } from '@/lib/member-facing-text-pii'
import { readPiiAllowedContacts } from '@/lib/site-board-server'
import { isWorkspaceSubject } from '@/lib/workspace-subject'

export const dynamic = 'force-dynamic'

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({
    success: false,
    error: { code, message },
  }, { status })
}

// 홈 화면 광고·진열 권한(storefront.edit)을 공용 가드로 확인한다. 오류 응답은 이 route의 기존 형식을 따른다.
async function requireAdminUser(permission: AdminPermissionRequirement = 'storefront.edit') {
  const guard = await requireAdminApiPermission(permission)
  if ('error' in guard) {
    const code = guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR'
    return { user: null, denied: NextResponse.json({ success: false, error: { code, message: adminApiGuardMessage(guard) } }, { status: guard.status }) } as const
  }
  return { user: { id: guard.access.userId }, denied: null } as const
}

// 회원에게 보이는 글(제목·빈 화면 문구·빈 홈 링크) 개인정보 모양 검사는 저장 때만 한다(22번 3-1, 14번 규칙).
function findPiiProblem(draft: MarketHomeDraft, allowed: Awaited<ReturnType<typeof readPiiAllowedContacts>>) {
  const texts = [...draft.sections.flatMap((section) => [section.title, section.emptyText]), draft.emptyHomeLink]
  for (const text of texts) {
    const hits = memberFacingTextPiiHits(text, allowed)
    if (hits.length > 0) return hits.map((kind) => MEMBER_FACING_PII_LABELS[kind]).join(', ')
  }
  return null
}

// 홈 진열 저장(22번 3-4): { expectedRevision, config: { sections, emptyHomeLink } }. 새 revision 은 서버가 정한다.
export async function POST(request: Request) {
  const { user, denied } = await requireAdminUser()
  if (denied) return denied

  const subject = new URL(request.url).searchParams.get('subject')
  if (!isWorkspaceSubject(subject)) {
    return errorResponse('INVALID_INPUT', '과목은 english 또는 korean이어야 합니다.', 400)
  }
  const workspaceSubject = subject

  let expectedRevision: number
  let draft: MarketHomeDraft
  try {
    const body = await request.json() as unknown
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('입력 형식이 올바르지 않습니다.')
    const input = body as Record<string, unknown>
    if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
      throw new Error('expectedRevision 은 0 이상 정수여야 합니다.')
    }
    expectedRevision = input.expectedRevision as number
    draft = validateMarketHomeDraft(input.config)
  } catch (error) {
    return errorResponse(
      'INVALID_INPUT',
      error instanceof Error ? error.message : '입력값을 확인해 주세요.',
      400
    )
  }

  const piiProblem = findPiiProblem(draft, await readPiiAllowedContacts())
  if (piiProblem) {
    return errorResponse('MEMBER_FACING_PII', `회원에게 보이는 글에 개인정보로 보이는 글이 있습니다(${piiProblem}). 지우고 저장해 주세요.`, 400)
  }

  let saved: Awaited<ReturnType<typeof saveMarketHomeConfig>>
  try {
    saved = await saveMarketHomeConfig({ workspaceSubject, expectedRevision, draft, actorId: user.id })
  } catch (error) {
    if (error instanceof MarketHomeRevisionConflictError) {
      return errorResponse('REVISION_CONFLICT', error.message, 409)
    }
    console.error('[market-home] 홈 진열 저장에 실패했습니다.', error instanceof Error ? error.message : error)
    return errorResponse('INTERNAL_ERROR', '홈 진열 설정 저장에 실패했습니다.', 500)
  }

  // 저장 성공 뒤 작업 기록(7절). 제목·문구 원문은 넣지 않는다. 기록이 실패해도 응답은 그대로(로그만, U3-5).
  await recordAdminAudit({
    actorId: user.id,
    action: 'market_home_sections_save',
    targetType: 'workspace_settings',
    targetId: `${workspaceSubject}:${MARKET_HOME_SETTING_KEY}`,
    details: {
      subject: workspaceSubject,
      previousRevision: saved.previousRevision,
      revision: saved.config.revision,
      sectionCount: saved.config.sections.length,
      changes: diffMarketHomeSections(saved.previousSections, saved.config.sections),
      emptyHomeLinkLength: saved.config.emptyHomeLink?.length ?? null,
      request: adminRequestMeta(request),
    },
  })

  // 회원 홈 캐시를 바로 비운다(상품 정보는 최대 1분 — 상품 캐시 태그는 그대로).
  revalidateTag(MARKET_HOME_CACHE_TAG, { expire: 0 })
  revalidatePath('/admin/market-main-settings')
  revalidatePath('/preview/solvook-concept')
  revalidatePath('/')
  return NextResponse.json({ success: true, data: { config: saved.config } })
}
