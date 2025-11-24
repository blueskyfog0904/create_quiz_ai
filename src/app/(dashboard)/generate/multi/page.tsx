import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import MultiGenerateClient from './multi-generate-client'

export default async function MultiGeneratePage() {
  await requireAuth()
  const supabase = await createClient()

  // Fetch all active problem types
  const { data: problemTypes } = await supabase
    .from('problem_types')
    .select('*')
    .eq('is_active', true)
    .order('type_name')

  return (
    <div className="container mx-auto py-8 px-4">
      <Link href="/generate">
        <Button variant="ghost" className="mb-4">← 문제 유형 선택으로</Button>
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">AI로 문제 생성하기</h1>
        <p className="text-gray-500">
          하나의 지문으로 여러 문제 유형을 동시에 생성하세요.
        </p>
      </div>
      
      <MultiGenerateClient problemTypes={problemTypes || []} />
    </div>
  )
}

