import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Construction, Users } from 'lucide-react'

export default function UsersAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">사용자 관리</h1>
        <p className="text-gray-500 mt-1">회원 정보 및 권한을 관리합니다</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5 text-yellow-500" />
            기능 준비중
          </CardTitle>
          <CardDescription>
            사용자 관리 기능이 곧 추가될 예정입니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Users className="h-16 w-16 text-gray-300" />
          </div>
          <p className="text-center text-gray-500">
            회원 목록 조회, 권한 설정, 관리자 지정 기능이 추가될 예정입니다
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
