import { requireAdmin } from '@/lib/auth'
import { AdminSidebar } from '@/components/layout/admin-sidebar'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Ensure user is admin before rendering any admin page
  await requireAdmin()

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

