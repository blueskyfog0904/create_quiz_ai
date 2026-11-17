import FooterSettingsClient from './footer-client'
import { getFooterSettingsData } from './actions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

export default async function FooterSettingsPage() {
  await requireAdminPagePermission('site.manage')
  const data = await getFooterSettingsData()

  return <FooterSettingsClient {...data} />
}
