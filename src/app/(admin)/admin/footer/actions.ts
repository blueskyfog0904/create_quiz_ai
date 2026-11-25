'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { getSiteFooterContent, saveSiteFooterContent } from '@/lib/footer-content-server'
import type { FooterContentConfig } from '@/lib/footer-content'
import { findProtectedFooterPolicyViolation } from '@/lib/footer-policy-raw'
import { readProtectedPolicySlugs } from '@/lib/signup-consent-server'
import { POLICY_UPCOMING_LOCKED_MESSAGE, isPolicyUpcomingLockedMessage } from '@/lib/site-notice-popup'
import { validateSiteBrand, type SiteBrand } from '@/lib/site-brand'
import { readSiteBrandForAdmin, saveSiteBrand } from '@/lib/site-brand-server'

function revalidateFooterPaths() {
  revalidatePath('/', 'layout')
  revalidatePath('/admin/footer')
  revalidatePath('/terms')
  revalidatePath('/terms/service')
  revalidatePath('/terms/privacy')
  revalidatePath('/terms/refund')
}

export interface FooterSettingsPageData {
  footerContent: FooterContentConfig
  // 사이트 이름·소개 문구. 읽지 못하면 null(화면은 저장을 막는다)
  siteBrand: SiteBrand | null
}

export async function getFooterSettingsData(): Promise<FooterSettingsPageData> {
  await requireAdmin()
  await assertAdminActionPermission('site.manage')

  const [footerContent, siteBrand] = await Promise.all([getSiteFooterContent(), readSiteBrandForAdmin()])
  return {
    footerContent,
    siteBrand: siteBrand.status === 'ok' ? siteBrand.brand : null,
  }
}

// 사이트 이름·소개 문구 저장(헤더·브라우저 탭 제목·하단·약관 화면에 쓰인다)
export async function saveSiteBrandAction(input: SiteBrand): Promise<{ success: true; data: SiteBrand } | { success: false; error: string }> {
  await requireAdmin()
  const access = await assertAdminActionPermission('site.manage')
  const candidate = { name: String(input?.name ?? ''), description: String(input?.description ?? '') }
  const invalid = validateSiteBrand(candidate)
  if (invalid) return { success: false, error: invalid }

  try {
    const saved = await saveSiteBrand(candidate)
    revalidatePath('/', 'layout')
    await recordAdminAudit({
      actorId: access.userId,
      action: 'site_brand_update',
      targetType: 'site_brand',
      details: { name: saved.name },
    })
    return { success: true, data: saved }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '사이트 기본 정보 저장에 실패했습니다.' }
  }
}

export async function saveSiteFooterContentAction(
  input: FooterContentConfig
): Promise<{ success: true; data: FooterContentConfig } | { success: false; error: string }> {
  await requireAdmin()
  const access = await assertAdminActionPermission('site.manage')

  // 가입 동의에 쓰이는 약관(활성 필수 항목이 연결한 문서 + 개인정보처리방침)은 끄거나 비울 수 없다 — 정규화 전 원본으로 본다
  // (정규화는 빈 본문을 코드 기본 약관으로 바꿔 이 검사를 지나치게 한다).
  const protectedSlugs = await readProtectedPolicySlugs()
  if (!protectedSlugs) {
    return { success: false, error: '가입 동의 항목을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
  const violation = findProtectedFooterPolicyViolation(input, protectedSlugs)
  if (violation) {
    return { success: false, error: violation }
  }

  try {
    const saved = await saveSiteFooterContent(input)
    revalidateFooterPaths()

    // 저장된 뒤 작업 기록을 남긴다(실패해도 결과는 그대로). 약관 본문은 길어 기록에 담지 않는다.
    await recordAdminAudit({
      actorId: access.userId,
      action: 'site_footer_save',
      targetType: 'site_footer',
    })

    return {
      success: true,
      data: saved,
    }
  } catch (error) {
    // 고지 기간에는 약관 문서(본문·이름·주소·켜기) 저장이 DB 트리거로 막힌다(15번 7-3).
    if (error instanceof Error && isPolicyUpcomingLockedMessage(error.message)) {
      return { success: false, error: POLICY_UPCOMING_LOCKED_MESSAGE }
    }
    return { success: false, error: error instanceof Error ? error.message : '하단 정보 저장에 실패했습니다.' }
  }
}

export const saveFooterContentAction = saveSiteFooterContentAction
