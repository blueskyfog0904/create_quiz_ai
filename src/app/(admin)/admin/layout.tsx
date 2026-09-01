import { requireAdminPanelUser } from '@/lib/auth'
import { AdminSidebar } from '@/components/layout/admin-sidebar'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 관리자 패널은 헤더 없이 사이드바+본문만 사용하며, 인증은 /admin/login으로 유도한다
  await requireAdminPanelUser()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex">
        {/* Sidebar */}
        <AdminSidebar />
        
        {/* Main Content Wrapper */}
        <div className="flex-1 flex flex-col min-h-screen md:ml-0">
          <main className="flex-1">
            <div className="p-6 md:p-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

