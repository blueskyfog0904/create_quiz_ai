'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
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
  await assertAdminActionPermission('site.manage')
  const saved = await saveSiteFooterContent(input)
  revalidateFooterPaths()

  return {
    success: true,
    data: saved,
  }
}

export const saveFooterContentAction = saveSiteFooterContentAction
