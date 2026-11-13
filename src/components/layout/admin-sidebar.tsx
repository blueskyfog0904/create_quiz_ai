import { getAdminSidebarNavigationConfig } from '@/lib/admin-sidebar-server'
import { isAdminPathDisabled } from '@/lib/admin-features'
import { getDisabledAdminFeatures } from '@/lib/admin-features-server'
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

  // 꺼진 기능 묶음의 메뉴는 그리지 않는다(설정을 읽지 못하면 묶음에 속한 메뉴를 모두 숨긴다).
  const disabledFeatures = await getDisabledAdminFeatures()
  const hiddenHrefs = koreanNavigationConfig.items.filter((href) => isAdminPathDisabled(href, disabledFeatures))

  return (
    <AdminMenuLabelsProvider navigationConfigs={navigationConfigs}>
      <AdminSidebarClient navigationConfigs={navigationConfigs} hiddenHrefs={hiddenHrefs} />
      {children}
    </AdminMenuLabelsProvider>
  )
}
