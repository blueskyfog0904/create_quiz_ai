import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { DEFAULT_WORKSPACE_SUBJECT, assertWorkspaceSubject } from '@/lib/workspace-subject'
import { PurchasedClient } from './purchased-client'

interface PurchasedPageProps {
  searchParams?: Promise<{
    jobId?: string
    marketSlug?: string
    subject?: string
  }>
}

export default async function PurchasedPage({ searchParams }: PurchasedPageProps) {
  const user = await requireAuth()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const jobId = resolvedSearchParams?.jobId
  const marketSlug = resolvedSearchParams?.marketSlug
  const workspaceSubject = resolvedSearchParams?.subject
    ? assertWorkspaceSubject(resolvedSearchParams.subject)
    : DEFAULT_WORKSPACE_SUBJECT
  const supabase = await createClient()

  let highlightedQuestionIds: string[] | null = null
  let highlightedSavedCount = 0
  let marketMenuTitle: string | null = null

  if (jobId) {
    const { data: jobItems, error: jobItemsError } = await supabase
      .from('generate_listboard_generation_job_items')
      .select('question_id')
      .eq('job_id', jobId)
      .eq('workspace_subject', workspaceSubject)
      .not('question_id', 'is', null)

    if (jobItemsError) {
      console.error('Error fetching job-linked questions:', jobItemsError)
    } else {
      highlightedQuestionIds = (jobItems ?? [])
        .map((item) => item.question_id)
        .filter((questionId): questionId is string => Boolean(questionId))
      highlightedSavedCount = highlightedQuestionIds.length
    }
  }

  if (marketSlug) {
    const { data: marketEntry, error: marketEntryError } = await supabase
      .from('market_menu_entries')
      .select('title')
      .eq('slug', marketSlug)
      .eq('workspace_subject', workspaceSubject)
      .is('deleted_at', null)
      .maybeSingle()

    if (marketEntryError) {
      console.error('Error fetching market menu entry:', marketEntryError)
    } else {
      marketMenuTitle = marketEntry?.title ?? null
    }
  }

  let questionsQuery = supabase
    .from('questions')
    .select('*, problem_types(type_name)')
    .eq('user_id', user.id)
    .in('source', ['ai_generated', 'from_community'])
    .eq('workspace_subject', workspaceSubject)
    .order('created_at', { ascending: false })

  if (highlightedQuestionIds) {
    if (highlightedQuestionIds.length > 0) {
      questionsQuery = questionsQuery.in('id', highlightedQuestionIds)
    } else {
      questionsQuery = questionsQuery.in('id', ['00000000-0000-0000-0000-000000000000'])
    }
  }

  const { data: rawQuestions, error: questionsError } = await questionsQuery

  if (questionsError) {
    console.error('Error fetching questions:', questionsError)
  }

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

    if (question.source !== 'from_community' || !metadata?.bank_problem_type_id) {
      return question
    }

    return {
      ...question,
      problem_type_id: metadata.bank_problem_type_id,
      problem_types: bankProblemType ? { type_name: bankProblemType.type_name } : null,
    }
  })

  const [{ data: aiProblemTypes, error: aiTypesError }, { data: bankProblemTypes, error: bankTypesError }] = await Promise.all([
    supabase
      .from('problem_types')
      .select('id, type_name')
      .eq('is_active', true)
      .eq('workspace_subject', workspaceSubject)
      .order('type_name'),
    supabase
      .from('question_bank_problem_types')
      .select('id, type_name')
      .eq('is_active', true)
      .eq('workspace_subject', workspaceSubject)
      .order('type_name'),
  ])

  if (aiTypesError || bankTypesError) {
    console.error('Error fetching problem types:', aiTypesError ?? bankTypesError)
  }

  const problemTypes = [...(aiProblemTypes ?? []), ...(bankProblemTypes ?? [])]

  const gradeLevels = Array.from(
    new Set(questions.map((question) => question.grade_level).filter(Boolean))
  ).sort()

  const difficulties = Array.from(
    new Set(questions.map((question) => question.difficulty).filter(Boolean))
  ).sort()

  return (
    <PurchasedClient
      questions={questions}
      problemTypes={problemTypes || []}
      gradeLevels={gradeLevels}
      difficulties={difficulties}
      highlightedJobId={highlightedQuestionIds ? jobId ?? null : null}
      highlightedSavedCount={highlightedSavedCount}
      initialSelectedSource={marketSlug ? 'from_community' : 'all'}
      marketMenuSlug={marketSlug ?? null}
      marketMenuTitle={marketMenuTitle}
      workspaceSubject={workspaceSubject}
    />
  )
}
