import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Database } from '@/types/supabase'

type ProblemType = Database['public']['Tables']['problem_types']['Row']

interface GenerateHomeContentProps {
  problemTypes: ProblemType[]
}

export default function GenerateHomeContent({ problemTypes }: GenerateHomeContentProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">문제 생성</h1>
        <p className="text-gray-500">
          문제 유형을 선택하여 AI 문제를 생성하세요.
        </p>
      </div>

      <div className="mb-6">
        <Link href="/generate/multi">
          <Card className="p-6 hover:shadow-lg transition-shadow cursor-pointer border-2 border-primary hover:border-primary/80 bg-gradient-to-r from-primary/5 to-primary/10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-primary mb-1">AI로 문제 생성하기</h2>
                <p className="text-sm text-gray-600">
                  하나의 지문으로 여러 문제 유형을 동시에 생성하세요
                </p>
              </div>
              <Badge variant="default" className="text-base px-4 py-2">
                다중 생성 →
              </Badge>
            </div>
          </Card>
        </Link>
      </div>

      {problemTypes.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <p className="text-gray-500 mb-4">
              등록된 문제 유형이 없습니다.
            </p>
            <p className="text-sm text-gray-400">
              관리자에게 문의하여 문제 유형을 추가해주세요.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {problemTypes.map((type) => (
            <Link key={type.id} href={`/generate/${type.id}`}>
              <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-primary">
                <CardHeader>
                  <div className="flex justify-between items-start mb-2">
                    <CardTitle className="text-xl">{type.type_name}</CardTitle>
                  </div>
                  {type.description && (
                    <CardDescription className="line-clamp-3">
                      {type.description}
                    </CardDescription>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
