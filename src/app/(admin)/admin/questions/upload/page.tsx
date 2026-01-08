import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Construction, Upload } from 'lucide-react'

export default function QuestionUploadPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">문제 업로드</h1>
        <p className="text-gray-500 mt-1">문제 파일을 일괄 업로드합니다</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5 text-yellow-500" />
            기능 준비중
          </CardTitle>
          <CardDescription>
            문제 일괄 업로드 기능이 곧 추가될 예정입니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-500">엑셀 또는 CSV 파일 업로드 기능이 준비중입니다</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
