import { Store } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function MarketPage() {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-2xl">
          <Store className="h-6 w-6 text-primary" />
          문제마켓
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-gray-600">
        <p>문제마켓 메인 페이지는 아직 준비 중입니다.</p>
        <p>좌측 사이드바에서 2단계 메뉴를 선택해 이동할 수 있습니다.</p>
      </CardContent>
    </Card>
  )
}
