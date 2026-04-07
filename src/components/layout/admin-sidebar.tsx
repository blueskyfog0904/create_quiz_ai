import { getAdminSidebarNavigationConfig } from '@/lib/admin-sidebar-server'
import { AdminSidebarClient } from './admin-sidebar-client'

export async function AdminSidebar() {
  const englishNavigationConfig = await getAdminSidebarNavigationConfig('english')
  const koreanNavigationConfig = await getAdminSidebarNavigationConfig('korean')

  return (
    <AdminSidebarClient
      navigationConfigs={{
        english: englishNavigationConfig,
        korean: koreanNavigationConfig,
      }}
    />
  )
}
