'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { getSiteFooterContent, saveSiteFooterContent } from '@/lib/footer-content-server'
import type { FooterContentConfig } from '@/lib/footer-content'

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
}

export async function getFooterSettingsData(): Promise<FooterSettingsPageData> {
  await requireAdmin()
  await assertAdminActionPermission('site.manage')

  return {
    footerContent: await getSiteFooterContent(),
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
