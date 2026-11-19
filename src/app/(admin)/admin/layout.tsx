import { requireAdminPanelUser } from '@/lib/auth'
import { AdminSidebar } from '@/components/layout/admin-sidebar'
import { AdminAlertProvider } from '@/components/admin/admin-alert-context'
import type { Metadata } from 'next'

// 관리자 화면 제목은 각 화면이 "메뉴 | 관리자 패널"로 정한다. 루트의 " | 사이트 이름" 템플릿을 여기서 끊는다.
export const metadata: Metadata = {
  title: { default: '관리자 패널', template: '%s' },
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 관리자 패널은 헤더 없이 사이드바+본문만 사용하며, 인증은 /admin/login으로 유도한다
  const admin = await requireAdminPanelUser()
  // 레이아웃이 다시 그려질 때마다(router.refresh·서버 액션 재검증) 바뀌는 값. 알림 요약을 다시 읽는 계기로 쓴다.
  // eslint-disable-next-line react-hooks/purity -- 서버 컴포넌트다. 요청마다 달라지는 값이 필요하다.
  const renderedAt = Date.now()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 알림 조회·실시간 구독은 여기서 한 번만 하고, 종과 메뉴 배지가 같이 쓴다 */}
      <AdminAlertProvider adminId={admin.id} renderedAt={renderedAt}>
      <div className="flex">
        {/* Sidebar (본문도 바꾼 메뉴 이름을 쓰도록 children으로 감싼다) */}
        <AdminSidebar>
          {/* Main Content Wrapper */}
          {/* 모바일: 고정 상단 바(56px) 아래에서 시작하고, 넓은 표가 페이지 전체를 옆으로 밀지 않게 한다 */}
          <div className="flex-1 flex flex-col min-h-screen max-md:min-w-0 md:ml-0">
            <main className="flex-1">
              <div className="p-6 max-md:px-4 max-md:pt-[4.5rem] md:p-8">
                {children}
              </div>
            </main>
          </div>
        </AdminSidebar>
      </div>
      </AdminAlertProvider>
    </div>
  )
}

