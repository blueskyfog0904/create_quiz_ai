import { getAdminSidebarNavigationConfig } from '@/lib/admin-sidebar-server'
import { ADMIN_SIDEBAR_MENU_REQUIREMENTS } from '@/lib/admin-sidebar'
import { isAdminPathDisabled } from '@/lib/admin-features'
import { getDisabledAdminFeatures } from '@/lib/admin-features-server'
import { hasAdminPermission, meetsAdminRequirement } from '@/lib/admin-permissions'
import { getAdminAccess } from '@/lib/admin-permissions-server'
import { AdminMenuLabelsProvider } from './admin-menu-labels'
import { AdminSidebarClient } from './admin-sidebar-client'

// children(본문)도 바꾼 메뉴 이름을 쓸 수 있게 같은 provider 안에 둔다
export async function AdminSidebar({ children }: { children?: React.ReactNode }) {
  // 순서·이름은 과목과 상관없이 하나다(국어·영어 마켓 묶음도 같은 설정을 쓴다)
  const navigationConfig = await getAdminSidebarNavigationConfig()

  // 꺼진 기능 묶음의 메뉴는 그리지 않는다(설정을 읽지 못하면 묶음에 속한 메뉴를 모두 숨긴다).
  const disabledFeatures = await getDisabledAdminFeatures()
  // 이 계정의 권한으로 열 수 없는 메뉴도 그리지 않는다(화면 가드가 막는 것과 같은 기준).
  // 권한 표에 없는 메뉴도 숨긴다(새 메뉴를 더하고 권한을 빠뜨리면 보이지 않게).
  // 권한 조회가 실패하면 메뉴를 모두 숨긴다(권한 화면은 가드가 오류 화면을 보인다. 대시보드는 관리자 여부만 보므로 그대로 열린다).
  const access = await getAdminAccess().catch(() => null)
  const hiddenHrefs = navigationConfig.items.filter((href) => {
    const requirement = ADMIN_SIDEBAR_MENU_REQUIREMENTS[href]
    return isAdminPathDisabled(href, disabledFeatures)
      || requirement === undefined
      || !meetsAdminRequirement(access, requirement)
  })

  return (
    <AdminMenuLabelsProvider navigationConfig={navigationConfig}>
      <AdminSidebarClient
        navigationConfig={navigationConfig}
        hiddenHrefs={hiddenHrefs}
        canRenameMenus={hasAdminPermission(access, 'site.manage')}
      />
      {children}
    </AdminMenuLabelsProvider>
  )
}
