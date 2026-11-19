'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assertAdminActionPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { validateStorefrontHeaderLinks, type StorefrontHeaderLink } from '@/lib/storefront-header-links'
import { saveStorefrontHeaderLinks } from '@/lib/storefront-header-links-server'

// 회원 헤더 운영 링크 저장(사이트 관리 권한)
export async function saveStorefrontHeaderLinksAction(
  input: StorefrontHeaderLink[]
): Promise<{ success: true; data: StorefrontHeaderLink[] } | { success: false; error: string }> {
  await requireAdmin()
  const access = await assertAdminActionPermission('site.manage')
  if (!Array.isArray(input)) return { success: false, error: '저장할 링크 목록이 올바르지 않습니다.' }
  const candidate: StorefrontHeaderLink[] = input.map((link) => ({
    label: String(link?.label ?? '').trim(),
    href: String(link?.href ?? '').trim(),
    isActive: link?.isActive !== false,
    emphasis: link?.emphasis === true,
  }))
  const invalid = validateStorefrontHeaderLinks(candidate)
  if (invalid) return { success: false, error: invalid }

  try {
    const saved = await saveStorefrontHeaderLinks(candidate)
    revalidatePath('/', 'layout')
    await recordAdminAudit({
      actorId: access.userId,
      action: 'storefront_header_links_update',
      targetType: 'storefront_header_links',
      details: { links: saved.map((link) => ({ label: link.label, href: link.href, isActive: link.isActive, emphasis: link.emphasis })) },
    })
    return { success: true, data: saved }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '상단 메뉴 저장에 실패했습니다.' }
  }
}
