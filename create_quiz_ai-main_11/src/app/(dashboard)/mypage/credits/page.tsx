import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Coins, TrendingUp, TrendingDown, Clock, Sparkles, ShoppingCart } from 'lucide-react'

export default async function CreditsPage() {
  const user = await requireAuth()
  const supabase = await createClient()

  // Fetch user credits (even if 0)
  const { data: credits } = await supabase
    .from('user_credits')
    .select('*')
    .eq('user_id', user.id)
    .single()

  const balance = credits?.balance || 0

  return (
    <div className="space-y-6">
      {/* Coming Soon Banner */}
      <Card className="bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200">
        <CardContent className="py-8">
          <div className="text-center">
            <Badge className="mb-4 bg-amber-100 text-amber-800 hover:bg-amber-100">
              Coming Soon
            </Badge>
            <h2 className="text-2xl font-bold text-amber-900 mb-2">크레딧 관리</h2>
            <p className="text-amber-700 max-w-md mx-auto">
              크레딧 시스템이 곧 추가될 예정입니다. 
              AI 문제 생성과 문제 구매에 사용할 수 있습니다.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Current Balance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-amber-500" />
            현재 보유 포인트
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <div className="text-5xl font-bold text-amber-600 mb-2">
              {balance.toLocaleString()}
            </div>
            <p className="text-gray-500">포인트</p>
          </div>
          
          <div className="flex justify-center gap-4 mt-4 opacity-50">
            <button 
              disabled 
              className="px-6 py-2 bg-amber-500 text-white rounded-lg cursor-not-allowed"
            >
              포인트 충전
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Usage Info */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-500" />
              AI 문제 생성
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-3">
              AI를 사용하여 문제를 생성할 때 포인트가 차감됩니다.
            </p>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium">예상 비용</p>
              <p className="text-xs text-gray-500">문제당 약 10~50 포인트 (예정)</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-green-500" />
              문제 구매
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-3">
              문제은행에서 문제를 가져올 때 포인트가 차감됩니다.
            </p>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium">예상 비용</p>
              <p className="text-xs text-gray-500">문제당 약 5~20 포인트 (예정)</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transaction History Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            거래 내역
          </CardTitle>
          <CardDescription>포인트 충전 및 사용 내역입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Empty State */}
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <Coins className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-gray-400 mb-2">아직 거래 내역이 없습니다.</p>
            <p className="text-sm text-gray-300">
              크레딧 시스템 출시 후 내역이 표시됩니다.
            </p>
          </div>

          {/* Preview Transaction Types */}
          <div className="mt-6 space-y-3 opacity-50">
            <div className="flex items-center gap-4 p-3 bg-green-50 rounded-lg">
              <TrendingUp className="h-5 w-5 text-green-600" />
              <div className="flex-1">
                <p className="text-sm font-medium">충전 내역 예시</p>
                <p className="text-xs text-gray-500">포인트가 충전되면 여기에 표시됩니다.</p>
              </div>
              <span className="text-green-600 font-medium">+1,000</span>
            </div>
            
            <div className="flex items-center gap-4 p-3 bg-red-50 rounded-lg">
              <TrendingDown className="h-5 w-5 text-red-600" />
              <div className="flex-1">
                <p className="text-sm font-medium">사용 내역 예시</p>
                <p className="text-xs text-gray-500">포인트가 사용되면 여기에 표시됩니다.</p>
              </div>
              <span className="text-red-600 font-medium">-50</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


