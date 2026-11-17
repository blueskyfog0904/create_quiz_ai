import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import LabelsAdminClient from './labels-client'

// 꺼 둔 기능의 화면이다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 본다.
export default async function LabelsAdminPage() {
  await requireAdminPagePermission('owner')

  return <LabelsAdminClient />
}
