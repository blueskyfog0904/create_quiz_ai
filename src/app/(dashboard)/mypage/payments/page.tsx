import { requireAuth } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CreditCard, Clock, Calendar } from 'lucide-react'

export default async function PaymentsPage() {
  await requireAuth()

  return (
    <div className="space-y-6">
      {/* Coming Soon Banner */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardContent className="py-8">
          <div className="text-center">
            <Badge className="mb-4 bg-blue-100 text-blue-800 hover:bg-blue-100">
              Coming Soon
            </Badge>
            <h2 className="text-2xl font-bold text-blue-900 mb-2">결제 내역</h2>
            <p className="text-blue-700 max-w-md mx-auto">
              결제 기능이 곧 추가될 예정입니다. 
              포인트 충전 및 결제 내역을 이곳에서 확인하실 수 있습니다.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Preview UI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            결제 내역
          </CardTitle>
          <CardDescription>포인트 충전 및 결제 내역입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Empty State Preview */}
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <CreditCard className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-400 mb-2">아직 결제 내역이 없습니다.</p>
            <p className="text-sm text-gray-300">
              결제 기능 출시 후 내역이 표시됩니다.
            </p>
          </div>

          {/* Preview Table Header */}
          <div className="mt-6 opacity-50">
            <div className="grid grid-cols-4 gap-4 px-4 py-3 bg-gray-100 rounded-lg text-sm font-medium text-gray-600">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                결제일
              </div>
              <div>결제 방법</div>
              <div>금액</div>
              <div>상태</div>
            </div>
            <div className="px-4 py-6 text-center text-gray-400 text-sm">
              결제 내역이 여기에 표시됩니다.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Future Features Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            예정된 기능
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
              포인트 충전 (신용카드, 계좌이체)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
              결제 내역 조회 및 영수증 발급
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
              자동 충전 설정
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
              결제 취소 및 환불 신청
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}


