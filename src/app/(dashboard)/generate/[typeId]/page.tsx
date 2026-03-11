import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import GenerateClient from './generate-client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import GenerateHomeContent from '../generate-home-content'

export default async function GenerateWithTypePage({ params }: { params: Promise<{ typeId: string }> }) {
  await requireAuth()
  const supabase = await createClient()
  const { typeId } = await params

  // Fetch the specific problem type
  const { data: problemType, error } = await supabase
    .from('problem_types')
    .select('*')
    .eq('id', typeId)
    .eq('is_active', true)
    .single()

  if (error || !problemType) {
    const { data: problemTypes } = await supabase
      .from('problem_types')
      .select('*')
      .eq('is_active', true)
      .neq('model_name', 'admin')
      .order('type_name')

    return <GenerateHomeContent problemTypes={problemTypes || []} />
  }

  return (
    <div>
      <Link href="/generate">
        <Button variant="ghost" className="mb-4">← 문제 유형 선택으로</Button>
      </Link>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold">{problemType.type_name}</h1>

        </div>
        {problemType.description && (
          <p className="text-gray-600">{problemType.description}</p>
        )}
      </div>
      
      <GenerateClient problemType={problemType} />
    </div>
  )
}
