import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { DEFAULT_WORKSPACE_SUBJECT, assertWorkspaceSubject } from '@/lib/workspace-subject'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Database } from '@/types/supabase'
import { ExamPaperView } from './exam-paper-view'

interface ExamPaperDetailPageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<{
    subject?: string
  }>
}

type ExamPaperItemWithQuestion = Database['public']['Tables']['exam_paper_items']['Row'] & {
  questions: Database['public']['Tables']['questions']['Row'] | Database['public']['Tables']['questions']['Row'][] | null
}

export default async function ExamPaperDetailPage({ params, searchParams }: ExamPaperDetailPageProps) {
  await requireAuth()
  const supabase = await createClient()
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolvedSearchParams?.subject
    ? assertWorkspaceSubject(resolvedSearchParams.subject)
    : DEFAULT_WORKSPACE_SUBJECT

  const { data: { user } } = await supabase.auth.getUser()

  // Fetch exam paper
  const { data: examPaper, error: examPaperError } = await supabase
    .from('exam_papers')
    .select('*')
    .eq('id', id)
    .eq('user_id', user!.id)
    .eq('workspace_subject', workspaceSubject)
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
    .eq('workspace_subject', workspaceSubject)
    .order('order_index')

  if (itemsError) {
    console.error('Error fetching items:', itemsError)
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <Link href={`/exam-papers?subject=${workspaceSubject}`}>
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
          questions={(items as ExamPaperItemWithQuestion[]).flatMap((item, index) => {
            const question = Array.isArray(item.questions) ? item.questions[0] : item.questions
            if (!question) {
              return []
            }
            // choices가 문자열로 저장된 경우 JSON.parse 처리
            const parsedChoices = typeof question.choices === 'string' 
              ? JSON.parse(question.choices) 
              : question.choices || []
            return [{
              number: index + 1,
              questionText: question.question_text,
              questionTextForward: question.question_text_forward || null,
              questionTextBackward: question.question_text_backward || null,
              passageText: question.passage_text || null,
              choices: parsedChoices,
              answer: question.answer,
              explanation: question.explanation || ''
            }]
          })}
        />
      )}
    </div>
  )
}
