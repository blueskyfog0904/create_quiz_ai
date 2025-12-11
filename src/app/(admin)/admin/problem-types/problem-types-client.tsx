'use client'

import { useRouter } from 'next/navigation'
import { deleteProblemType } from './actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Database } from '@/types/supabase'

type ProblemType = Database['public']['Tables']['problem_types']['Row']

interface ProblemTypesClientProps {
  initialTypes: ProblemType[]
}

export default function ProblemTypesClient({ initialTypes }: ProblemTypesClientProps) {
  const router = useRouter()

  const handleDelete = async (id: string) => {
    if (!confirm("이 문제 유형을 정말 삭제하시겠습니까?")) return
    const result = await deleteProblemType(id)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success("문제 유형이 삭제되었습니다")
    }
  }

  const handleCreate = () => {
    router.push('/admin/problem-types/new')
  }

  const handleEdit = (id: string) => {
    router.push(`/admin/problem-types/${id}/edit`)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">등록된 유형</h2>
        <Button onClick={handleCreate}>새 유형 추가</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {initialTypes.map((type) => (
          <Card key={type.id}>
            <CardHeader>
              <CardTitle className="flex justify-between">
                <span>{type.type_name}</span>
                <span className={`text-xs px-2 py-1 rounded ${type.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {type.is_active ? '활성' : '비활성'}
                </span>
              </CardTitle>
              <CardDescription>{type.provider} / {type.model_name}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 line-clamp-2 mb-4">{type.description}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => handleEdit(type.id)}>수정</Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(type.id)}>삭제</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

