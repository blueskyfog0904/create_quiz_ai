import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import AIConnectionsClient from './ai-connections-client'

export default async function AIConnectionsPage() {
  // 꺼 둔 기능의 화면이다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 본다.
  await requireAdminPagePermission('owner')

  return (
    <div className="container mx-auto py-8">
      <AIConnectionsClient />
    </div>
  )
}
