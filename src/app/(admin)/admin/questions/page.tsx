import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Construction } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function QuestionsAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">문제은행 관리</h1>
        <p className="text-gray-500 mt-1">등록된 문제를 관리하고 수정합니다</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5 text-yellow-500" />
            기능 준비중
          </CardTitle>
          <CardDescription>
            문제은행 관리 기능이 곧 추가될 예정입니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">
            현재 문제 관리는 '내 라이브러리 &gt; 영어문제 관리' 페이지에서 가능합니다.
          </p>
          <Link href="/library/purchased">
            <Button variant="outline">영어문제 관리로 이동</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
