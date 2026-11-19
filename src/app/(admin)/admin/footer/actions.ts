'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { getSiteFooterContent, saveSiteFooterContent } from '@/lib/footer-content-server'
import type { FooterContentConfig } from '@/lib/footer-content'
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

export async function saveSiteFooterContentAction(input: FooterContentConfig) {
  await requireAdmin()
  const access = await assertAdminActionPermission('site.manage')
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
}

export const saveFooterContentAction = saveSiteFooterContentAction
