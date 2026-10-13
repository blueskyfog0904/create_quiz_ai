import { getAdminSidebarNavigationConfig } from '@/lib/admin-sidebar-server'
import { AdminMenuLabelsProvider } from './admin-menu-labels'
import { AdminSidebarClient } from './admin-sidebar-client'

// children(본문)도 바꾼 메뉴 이름을 쓸 수 있게 같은 provider 안에 둔다
export async function AdminSidebar({ children }: { children?: React.ReactNode }) {
  const englishNavigationConfig = await getAdminSidebarNavigationConfig('english')
  const koreanNavigationConfig = await getAdminSidebarNavigationConfig('korean')

  const navigationConfigs = {
    english: englishNavigationConfig,
    korean: koreanNavigationConfig,
  }

  return (
    <AdminMenuLabelsProvider navigationConfigs={navigationConfigs}>
      <AdminSidebarClient navigationConfigs={navigationConfigs} />
      {children}
    </AdminMenuLabelsProvider>
  )
}
