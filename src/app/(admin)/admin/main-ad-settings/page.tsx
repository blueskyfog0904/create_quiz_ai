import { requireAdmin } from '@/lib/auth'
import { getMainAdCarouselAdminData } from '@/lib/main-ad-carousel-server'
import MainAdSettingsClient from './main-ad-settings-client'

export default async function MainAdSettingsPage() {
  await requireAdmin('/admin/main-ad-settings')
  const data = await getMainAdCarouselAdminData()

  return <MainAdSettingsClient {...data} />
}
