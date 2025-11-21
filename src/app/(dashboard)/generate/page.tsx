import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default async function GeneratePage() {
  await requireAuth()
  const supabase = await createClient()

  const { data: problemTypes } = await supabase
    .from('problem_types')
    .select('*')
    .eq('is_active', true)
    .order('type_name')

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">문제 생성</h1>
        <p className="text-gray-500">
          문제 유형을 선택하여 AI 문제를 생성하세요.
        </p>
      </div>

      {!problemTypes || problemTypes.length === 0 ? (
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
                    <Badge variant={type.provider === 'openai' ? 'default' : 'secondary'}>
                      {type.provider === 'openai' ? 'OpenAI' : 'Gemini'}
                    </Badge>
                  </div>
                  {type.description && (
                    <CardDescription className="line-clamp-3">
                      {type.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-gray-600">
                    <p className="font-mono text-xs bg-gray-50 p-2 rounded line-clamp-2">
                      Model: {type.model_name}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
