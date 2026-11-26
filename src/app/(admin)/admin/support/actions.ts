'use server'

import { headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { UUID_PATTERN } from '@/lib/admin-orders'
import { createAdminClient } from '@/lib/supabase/bypass'
import { validateSupportReplyTemplate } from '@/lib/support-reply-template'
import {
  SUPPORT_PAGE_CONTENT_SETTING_KEY,
  SUPPORT_PAGE_MEMBER_KEYS,
  validateSupportPageContentInput,
  type SupportPageContent,
  type SupportPageContentInput,
} from '@/lib/support-page-content'
import { readSupportPageContentForAdmin, saveSupportPageContent } from '@/lib/support-page-content-server'
import type { SupportReplyTemplateRow } from './reply-template-tools'

// 13번 묶음: 답변 템플릿(6절, support.manage — Q8 가)과 고객지원 안내 문구(9절, 대표만 — Q9 가).
// 순서: 가드 → 서버 키 → revision 비교 → 작업 기록(details.request = IP·기기). 결과는 객체로 돌려준다(던진 오류 글은 운영에서 가려진다).
type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; conflict?: boolean }

const TEMPLATE_COLUMNS = 'id, title, body, category_id, sort_order, is_active, deleted_at, revision, created_at, updated_at'

const db = () => createAdminClient() as unknown as SupabaseClient

async function requestMeta() {
  return adminRequestMeta(await headers())
}

export interface SupportReplyTemplateInput {
  id?: string | null
  revision?: number | null
  title: string
  body: string
  categoryId: string | null
  sortOrder: number
  isActive: boolean
}

export async function saveSupportReplyTemplateAction(input: SupportReplyTemplateInput): Promise<ActionResult<SupportReplyTemplateRow>> {
  const access = await assertAdminActionPermission('support.manage')
  const invalid = validateSupportReplyTemplate({ title: String(input?.title ?? ''), body: String(input?.body ?? '') })
  if (invalid) return { ok: false, error: invalid }
  if (input.categoryId !== null && !UUID_PATTERN.test(String(input.categoryId))) return { ok: false, error: '카테고리가 올바르지 않습니다.' }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 9999) return { ok: false, error: '순서는 0~9999 사이 정수로 적어 주세요.' }
  if (typeof input.isActive !== 'boolean') return { ok: false, error: '사용 여부가 올바르지 않습니다.' }

  const values = {
    title: input.title.trim(),
    body: input.body.trim(),
    category_id: input.categoryId,
    sort_order: input.sortOrder,
    is_active: input.isActive,
    updated_by: access.userId,
    updated_at: new Date().toISOString(),
  }
  const isNew = !input.id
  let saved: SupportReplyTemplateRow | null
  if (isNew) {
    const { data, error } = await db().from('support_reply_templates')
      .insert({ ...values, created_by: access.userId }).select(TEMPLATE_COLUMNS).single()
    if (error) return { ok: false, error: '템플릿을 저장하지 못했습니다.' }
    saved = data as SupportReplyTemplateRow
  } else {
    if (!UUID_PATTERN.test(String(input.id)) || !Number.isInteger(input.revision)) return { ok: false, error: '템플릿을 찾을 수 없습니다.' }
    const { data, error } = await db().from('support_reply_templates')
      .update({ ...values, revision: Number(input.revision) + 1 })
      .eq('id', input.id).eq('revision', input.revision).is('deleted_at', null)
      .select(TEMPLATE_COLUMNS).maybeSingle()
    if (error) return { ok: false, error: '템플릿을 저장하지 못했습니다.' }
    if (!data) return { ok: false, conflict: true, error: '다른 관리자가 먼저 고쳤거나 숨긴 템플릿입니다. 화면을 새로고침해 최신 값을 확인해 주세요.' }
    saved = data as SupportReplyTemplateRow
  }

  await recordAdminAudit({
    actorId: access.userId,
    action: 'support_reply_template_save',
    targetType: 'support_reply_template',
    targetId: saved.id,
    details: {
      created: isNew,
      revision: saved.revision,
      titleLength: saved.title.length,
      bodyLength: saved.body.length,
      categoryId: saved.category_id,
      isActive: saved.is_active,
      sortOrder: saved.sort_order,
      request: await requestMeta(),
    },
  })
  return { ok: true, data: saved }
}

export async function hideSupportReplyTemplateAction(input: { id: string; revision: number }): Promise<ActionResult<{ id: string }>> {
  const access = await assertAdminActionPermission('support.manage')
  if (!UUID_PATTERN.test(String(input?.id)) || !Number.isInteger(input?.revision)) return { ok: false, error: '템플릿을 찾을 수 없습니다.' }
  const now = new Date().toISOString()
  const { data, error } = await db().from('support_reply_templates')
    .update({ deleted_at: now, is_active: false, revision: input.revision + 1, updated_by: access.userId, updated_at: now })
    .eq('id', input.id).eq('revision', input.revision).is('deleted_at', null)
    .select('id').maybeSingle()
  if (error) return { ok: false, error: '템플릿을 숨기지 못했습니다.' }
  if (!data) return { ok: false, conflict: true, error: '다른 관리자가 먼저 고쳤거나 이미 숨긴 템플릿입니다. 화면을 새로고침해 주세요.' }

  await recordAdminAudit({
    actorId: access.userId,
    action: 'support_reply_template_hide',
    targetType: 'support_reply_template',
    targetId: input.id,
    details: { revision: input.revision + 1, request: await requestMeta() },
  })
  return { ok: true, data: { id: input.id } }
}

export async function getSupportPageContentAdminData(): Promise<ActionResult<SupportPageContent>> {
  await assertAdminActionPermission('owner')
  const result = await readSupportPageContentForAdmin()
  if (result.status !== 'ok') return { ok: false, error: '고객지원 문구를 읽지 못했습니다.' }
  return { ok: true, data: result.content }
}

export async function saveSupportPageContentAction(input: SupportPageContentInput): Promise<ActionResult<SupportPageContent>> {
  const access = await assertAdminActionPermission('owner')
  const current = await readSupportPageContentForAdmin()
  if (current.status !== 'ok') return { ok: false, error: '지금 저장된 고객지원 문구를 읽지 못해 저장하지 않았습니다.' }
  const checked = validateSupportPageContentInput(input, current.content)
  if (!checked.ok) {
    if (checked.error === 'REVISION_CONFLICT') {
      return { ok: false, conflict: true, error: '다른 곳에서 먼저 저장했습니다. 최신 문구를 다시 불러왔으니 확인 후 다시 저장해 주세요.' }
    }
    return { ok: false, error: checked.error }
  }
  const saved = await saveSupportPageContent(checked.content, current.content.revision)
  if (!saved) return { ok: false, conflict: true, error: '다른 곳에서 먼저 저장했습니다. 최신 문구를 다시 불러왔으니 확인 후 다시 저장해 주세요.' }

  const changedKeys = [
    ...SUPPORT_PAGE_MEMBER_KEYS.filter((key) => checked.content.member[key] !== current.content.member[key]).map((key) => `member.${key}`),
    ...(checked.content.admin.answerEditReasonGuide !== current.content.admin.answerEditReasonGuide ? ['admin.answerEditReasonGuide'] : []),
    ...(checked.content.admin.notifyOnAnswerEdit !== current.content.admin.notifyOnAnswerEdit ? ['admin.notifyOnAnswerEdit'] : []),
  ]
  await recordAdminAudit({
    actorId: access.userId,
    action: 'support_page_content_update',
    targetType: 'system_settings',
    targetId: SUPPORT_PAGE_CONTENT_SETTING_KEY,
    details: { revision: checked.content.revision, changedKeys, request: await requestMeta() },
  })
  return { ok: true, data: checked.content }
}
