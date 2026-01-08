import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Construction, MessageSquare } from 'lucide-react'

export default function SupportAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">고객지원 관리</h1>
        <p className="text-gray-500 mt-1">고객 문의 및 지원 요청을 관리합니다</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5 text-yellow-500" />
            기능 준비중
          </CardTitle>
          <CardDescription>
            고객지원 관리 기능이 곧 추가될 예정입니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <MessageSquare className="h-16 w-16 text-gray-300" />
          </div>
          <p className="text-center text-gray-500">
            문의 접수, 답변 관리, FAQ 관리 기능이 추가될 예정입니다
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
