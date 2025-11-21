import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notFound } from 'next/navigation'
import GenerateClient from './generate-client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

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
    notFound()
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <Link href="/generate">
        <Button variant="ghost" className="mb-4">← 문제 유형 선택으로</Button>
      </Link>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold">{problemType.type_name}</h1>
          <Badge variant={problemType.provider === 'openai' ? 'default' : 'secondary'}>
            {problemType.provider === 'openai' ? 'OpenAI' : 'Gemini'}
          </Badge>
        </div>
        {problemType.description && (
          <p className="text-gray-600 mb-2">{problemType.description}</p>
        )}
        <p className="text-sm text-gray-500">
          Model: {problemType.model_name}
        </p>
      </div>
      
      <GenerateClient problemType={problemType} />
    </div>
  )
}

