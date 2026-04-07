'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { getSiteFooterContent, saveSiteFooterContent } from '@/lib/footer-content-server'
import type { FooterContentConfig } from '@/lib/footer-content'

function revalidateFooterPaths() {
  revalidatePath('/', 'layout')
  revalidatePath('/admin/footer')
}

export interface FooterSettingsPageData {
  footerContent: FooterContentConfig
}

export async function getFooterSettingsData(): Promise<FooterSettingsPageData> {
  await requireAdmin()

  return {
    footerContent: await getSiteFooterContent(),
  }
}

export async function saveSiteFooterContentAction(input: FooterContentConfig) {
  await requireAdmin()
  const saved = await saveSiteFooterContent(input)
  revalidateFooterPaths()

  return {
    success: true,
    data: saved,
  }
}

export const saveFooterContentAction = saveSiteFooterContentAction
