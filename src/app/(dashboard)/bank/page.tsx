import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_WORKSPACE_SUBJECT, assertWorkspaceSubject } from '@/lib/workspace-subject'
import BankClient from './bank-client'

interface BankPageProps {
  searchParams?: Promise<{
    subject?: string
  }>
}

export default async function BankPage({ searchParams }: BankPageProps) {
  const user = await requireAuth()
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolvedSearchParams?.subject
    ? assertWorkspaceSubject(resolvedSearchParams.subject)
    : DEFAULT_WORKSPACE_SUBJECT
  
  // Check if user is admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  
  const isAdmin = profile?.is_admin || false
  
  // Fetch admin-uploaded questions and overlay the dedicated question-bank problem type.
  const { data: rawQuestions, error: questionsError } = await supabase
    .from('questions')
    .select('*')
    .eq('source', 'admin_uploaded')
    .eq('workspace_subject', workspaceSubject)
    .order('created_at', { ascending: false })
  
  const questionIds = (rawQuestions ?? []).map((question) => question.id)
  const { data: metadataRows } = questionIds.length > 0
    ? await supabase
      .from('question_bank_question_metadata')
      .select('question_id, bank_problem_type_id')
      .in('question_id', questionIds)
      .eq('workspace_subject', workspaceSubject)
    : { data: [] }
  const bankProblemTypeIds = Array.from(new Set((metadataRows ?? [])
    .map((row) => row.bank_problem_type_id)
    .filter((id): id is string => Boolean(id))))
  const { data: bankProblemTypeRows } = bankProblemTypeIds.length > 0
    ? await supabase
      .from('question_bank_problem_types')
      .select('id, type_name')
      .in('id', bankProblemTypeIds)
      .eq('workspace_subject', workspaceSubject)
    : { data: [] }
  const metadataByQuestionId = new Map((metadataRows ?? []).map((row) => [row.question_id, row]))
  const bankProblemTypeById = new Map((bankProblemTypeRows ?? []).map((row) => [row.id, row]))
  const questions = (rawQuestions ?? []).map((question) => {
    const metadata = metadataByQuestionId.get(question.id)
    const bankProblemType = metadata?.bank_problem_type_id
      ? bankProblemTypeById.get(metadata.bank_problem_type_id)
      : null

    return {
      ...question,
      problem_type_id: metadata?.bank_problem_type_id ?? question.problem_type_id,
      problem_types: bankProblemType ? { type_name: bankProblemType.type_name } : null,
    }
  })

  console.log('[Bank] Questions fetched:', questions.length || 0)
  console.log('[Bank] User ID:', user.id)
  console.log('[Bank] Is Admin:', isAdmin)
  if (questionsError) {
    console.error('[Bank] Error fetching questions:', questionsError)
  }
  
  // Fetch problem types for filtering
  const { data: problemTypes } = await supabase
    .from('question_bank_problem_types')
    .select('id, type_name')
    .eq('is_active', true)
    .eq('workspace_subject', workspaceSubject)
    .order('type_name')
  
  // Get unique grade levels and difficulties
  const gradeLevels = Array.from(new Set(questions.map(q => q.grade_level).filter(Boolean)))
  const difficulties = Array.from(new Set(questions.map(q => q.difficulty).filter(Boolean)))
  
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">문제은행</h1>
        <p className="text-gray-500">
          관리자가 업로드한 문제를 확인하고, 원하는 문제를 내 라이브러리로 가져와서 문제지를 만들 수 있습니다.
        </p>
      </div>
      
      <BankClient 
        initialQuestions={questions} 
        problemTypes={problemTypes || []}
        gradeLevels={gradeLevels}
        difficulties={difficulties}
        isAdmin={isAdmin}
        workspaceSubject={workspaceSubject}
      />
    </div>
  )
}
