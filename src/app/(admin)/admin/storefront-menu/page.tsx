import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { readStorefrontHeaderLinksForAdmin } from '@/lib/storefront-header-links-server'
import { StorefrontMenuClient } from './storefront-menu-client'

// 회원 화면 헤더 오른쪽 운영 링크(크레딧 충전 등) 관리
export default async function StorefrontMenuPage() {
  await requireAdminPagePermission('site.manage')
  const result = await readStorefrontHeaderLinksForAdmin()

  return <StorefrontMenuClient initialLinks={result.status === 'ok' ? result.links : null} />
}
