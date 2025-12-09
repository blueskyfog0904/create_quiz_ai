import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExportButtons } from './export-buttons'
import { ExamPaperView } from './exam-paper-view'

export default async function ExamPaperDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth()
  const supabase = await createClient()
  const { id } = await params

  const { data: { user } } = await supabase.auth.getUser()

  // Fetch exam paper
  const { data: examPaper, error: examPaperError } = await supabase
    .from('exam_papers')
    .select('*')
    .eq('id', id)
    .eq('user_id', user!.id)
    .single()

  if (examPaperError || !examPaper) {
    notFound()
  }

  // Fetch exam paper items with questions
  const { data: items, error: itemsError } = await supabase
    .from('exam_paper_items')
    .select(`
      *,
      questions (*)
    `)
    .eq('exam_paper_id', id)
    .order('order_index')

  if (itemsError) {
    console.error('Error fetching items:', itemsError)
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <Link href="/exam-papers">
          <Button variant="ghost" className="mb-4">← 목록으로</Button>
        </Link>
        
        <Card>
          <CardHeader>
            <CardTitle className="text-3xl">{examPaper.paper_title}</CardTitle>
            {examPaper.description && (
              <p className="text-gray-600 mt-2">{examPaper.description}</p>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex gap-6 text-sm text-gray-600">
              <p>📝 총 문제 수: {items?.length || 0}개</p>
              <p>📅 생성일: {new Date(examPaper.created_at).toLocaleDateString('ko-KR')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {!items || items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-gray-500">
            문제가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <ExamPaperView
          examPaper={examPaper}
          questions={items.map((item, index) => {
            const question = item.questions as any
            return {
              number: index + 1,
              questionText: question.question_text,
              questionTextForward: question.question_text_forward || null,
              questionTextBackward: question.question_text_backward || null,
              choices: question.choices as any,
              answer: question.answer,
              explanation: question.explanation || ''
            }
          })}
        />
      )}
    </div>
  )
}

