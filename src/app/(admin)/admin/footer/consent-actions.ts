'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { listFooterPolicyDocumentSlugs } from '@/lib/footer-content'
import { normalizeConsentText } from '@/lib/consent-text'
import {
  getConsentErrorMessage,
  normalizeSignupConsentTexts,
  validateSignupConsentTexts,
  type SignupConsentTexts,
} from '@/lib/signup-consent'
import {
  callReviseConsentItem,
  callSaveConsentItem,
  readConsentItemsForAdmin,
  readRawPolicyDocument,
  readSignupConsentTextsForAdmin,
  saveSignupConsentTexts,
  type AdminConsentItem,
  type ConsentItemSaveResult,
  type SaveConsentItemInput,
} from '@/lib/signup-consent-server'

// 가입 동의 항목 관리(대표 전용 — 메뉴 이름만 고치는 site.manage 권한자가 전 회원 재동의를 일으키지 않게).
// 저장·개정의 작업 기록은 DB 함수가 같은 트랜잭션에서 남긴다(signup_consent_item_save·signup_consent_item_revise).

export type ConsentPolicyOption = { slug: string; label: string; available: boolean }

export type SignupConsentAdminData =
  | { ok: true; items: AdminConsentItem[]; texts: SignupConsentTexts | null; policyOptions: ConsentPolicyOption[] }
  | { ok: false; error: string }

const ADMIN_CONSENT_ERRORS: Record<string, string> = {
  CONSENT_ITEM_ACTOR_NOT_OWNER: '대표 계정만 바꿀 수 있습니다.',
  CONSENT_ITEM_NOT_FOUND: '항목을 찾지 못했습니다. 새로고침해 주세요.',
  CONSENT_ITEM_VERSION_CONFLICT: '그 사이 다른 곳에서 이 항목이 바뀌었습니다. 최신 내용을 다시 불러왔으니 확인 후 다시 저장하세요.',
  CONSENT_ITEM_LOCKED: '필수 고정 항목은 선택으로 바꾸거나 숨길 수 없고, 선택 고정 항목은 필수로 바꿀 수 없습니다.',
  CONSENT_OPTIONAL_ITEM_IN_USE: '동의 기록이 있는 선택 항목은 문구를 바꿀 수 없습니다. 새 선택 항목을 만들고 이 항목을 숨기세요(숨겨도 회원은 선택 동의 관리에서 철회할 수 있습니다).',
  CONSENT_NOTE_REQUIRED: '회원에게 보이는 변경 안내를 입력해 주세요.',
  CONSENT_NO_REQUIRED_ITEM: '보이는 필수 항목이 하나 이상 있어야 합니다.',
  CONSENT_REVISE_NOT_ALLOWED: '다시 동의 받기는 연결 약관이 있는 보이는 필수 항목에만 쓸 수 있습니다.',
  CONSENT_INPUT_INVALID: '입력값을 확인해 주세요(필수 항목은 내용이 있어야 하고, 이름 앞에 [필수]/[선택]을 붙이지 않습니다).',
}

function adminConsentError(code: string) {
  return ADMIN_CONSENT_ERRORS[code] ?? getConsentErrorMessage(code)
}

async function readPolicyOptions(): Promise<ConsentPolicyOption[]> {
  return Promise.all(listFooterPolicyDocumentSlugs().map(async (document) => ({
    slug: document.slug,
    label: document.label,
    available: (await readRawPolicyDocument(document.slug)).ok,
  })))
}

export async function getSignupConsentAdminData(): Promise<SignupConsentAdminData> {
  await requireAdmin()
  await assertAdminActionPermission('owner')
  const [items, texts, policyOptions] = await Promise.all([
    readConsentItemsForAdmin(),
    readSignupConsentTextsForAdmin(),
    readPolicyOptions(),
  ])
  if (!items) {
    return { ok: false, error: '가입 동의 항목을 불러오지 못했습니다.' }
  }
  return { ok: true, items, texts, policyOptions }
}

function parseSaveInput(input: SaveConsentItemInput): SaveConsentItemInput | null {
  if (!input || typeof input !== 'object') return null
  const sortOrder = Number(input.sortOrder)
  const expectedVersion = input.expectedVersion === null ? null : Number(input.expectedVersion)
  if (!Number.isInteger(sortOrder) || sortOrder < -100000 || sortOrder > 100000) return null
  if (input.id !== null && (typeof input.id !== 'string' || !Number.isInteger(expectedVersion) || typeof input.expectedUpdatedAt !== 'string')) {
    return null
  }
  if (typeof input.required !== 'boolean' || typeof input.isActive !== 'boolean') return null
  const policySlug = typeof input.policySlug === 'string' && input.policySlug.trim() ? input.policySlug.trim() : null
  return {
    id: input.id,
    expectedVersion,
    // 문자열(마이크로초) 그대로 넘긴다 — Date 로 바꾸지 않는다.
    expectedUpdatedAt: input.id === null ? null : input.expectedUpdatedAt,
    label: normalizeConsentText(input.label),
    content: normalizeConsentText(input.content),
    required: input.required,
    policySlug,
    sortOrder,
    isActive: input.isActive,
    note: normalizeConsentText(input.note) || null,
  }
}

export type ConsentItemActionResult =
  | { success: true; result: ConsentItemSaveResult }
  | { success: false; error: string; code: string }

// dryRun=true 이면 저장하지 않고 '버전이 오르는지·재동의 발생 여부·영향 회원 수'만 돌려준다(확인 창용).
export async function saveSignupConsentItemAction(rawInput: SaveConsentItemInput, dryRun: boolean): Promise<ConsentItemActionResult> {
  await requireAdmin()
  const access = await assertAdminActionPermission('owner')
  const input = parseSaveInput(rawInput)
  if (!input) {
    return { success: false, error: adminConsentError('CONSENT_INPUT_INVALID'), code: 'CONSENT_INPUT_INVALID' }
  }
  // 연결 약관은 하단 정보에 있고 켜져 있으며 본문이 있는 문서만.
  if (input.policySlug && !(await readRawPolicyDocument(input.policySlug)).ok) {
    return { success: false, error: '연결할 약관 문서가 없거나 꺼져 있습니다. 하단 정보에서 문서를 먼저 확인하세요.', code: 'CONSENT_POLICY_UNAVAILABLE' }
  }
  const outcome = await callSaveConsentItem(access.userId, input, dryRun === true)
  if (!outcome.ok) {
    return { success: false, error: adminConsentError(outcome.code), code: outcome.code }
  }
  if (!dryRun) {
    revalidatePath('/admin/footer')
  }
  return { success: true, result: outcome.result }
}

export async function reviseSignupConsentItemAction(id: string, expectedVersion: number, note: string, dryRun: boolean): Promise<ConsentItemActionResult> {
  await requireAdmin()
  const access = await assertAdminActionPermission('owner')
  if (typeof id !== 'string' || !Number.isInteger(expectedVersion)) {
    return { success: false, error: adminConsentError('CONSENT_INPUT_INVALID'), code: 'CONSENT_INPUT_INVALID' }
  }
  const outcome = await callReviseConsentItem(access.userId, id, expectedVersion, normalizeConsentText(note) || null, dryRun === true)
  if (!outcome.ok) {
    return { success: false, error: adminConsentError(outcome.code), code: outcome.code }
  }
  if (!dryRun) {
    revalidatePath('/admin/footer')
  }
  return { success: true, result: outcome.result }
}

export async function saveSignupConsentTextsAction(input: SignupConsentTexts): Promise<{ success: true; data: SignupConsentTexts } | { success: false; error: string }> {
  await requireAdmin()
  const access = await assertAdminActionPermission('owner')
  const texts = normalizeSignupConsentTexts(input)
  const invalid = validateSignupConsentTexts(texts)
  if (invalid) {
    return { success: false, error: invalid }
  }
  try {
    await saveSignupConsentTexts(texts)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '가입 동의 안내 문구를 저장하지 못했습니다.' }
  }
  revalidatePath('/admin/footer')
  await recordAdminAudit({
    actorId: access.userId,
    action: 'signup_consent_texts_update',
    targetType: 'system_setting',
    targetId: 'signup_consent_texts',
  })
  return { success: true, data: texts }
}
