import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { PurchasedClient } from './purchased-client'

interface PurchasedPageProps {
  searchParams?: Promise<{
    jobId?: string
    marketSlug?: string
  }>
}

export default async function PurchasedPage({ searchParams }: PurchasedPageProps) {
  await requireAuth()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const jobId = resolvedSearchParams?.jobId
  const marketSlug = resolvedSearchParams?.marketSlug
  const supabase = await createClient()

  let highlightedQuestionIds: string[] | null = null
  let highlightedSavedCount = 0
  let marketMenuTitle: string | null = null

  if (jobId) {
    const { data: jobItems, error: jobItemsError } = await supabase
      .from('generate_listboard_generation_job_items')
      .select('question_id')
      .eq('job_id', jobId)
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
    .in('source', ['ai_generated', 'from_community'])
    .order('created_at', { ascending: false })

  if (highlightedQuestionIds) {
    if (highlightedQuestionIds.length > 0) {
      questionsQuery = questionsQuery.in('id', highlightedQuestionIds)
    } else {
      questionsQuery = questionsQuery.in('id', ['00000000-0000-0000-0000-000000000000'])
    }
  }

  const { data: questions, error: questionsError } = await questionsQuery

  if (questionsError) {
    console.error('Error fetching questions:', questionsError)
  }

  const { data: problemTypes, error: typesError } = await supabase
    .from('problem_types')
    .select('id, type_name')
    .eq('is_active', true)
    .order('type_name')

  if (typesError) {
    console.error('Error fetching problem types:', typesError)
  }

  const gradeLevels = Array.from(
    new Set(questions?.map((question) => question.grade_level).filter(Boolean))
  ).sort()

  const difficulties = Array.from(
    new Set(questions?.map((question) => question.difficulty).filter(Boolean))
  ).sort()

  return (
    <PurchasedClient
      questions={questions || []}
      problemTypes={problemTypes || []}
      gradeLevels={gradeLevels}
      difficulties={difficulties}
      highlightedJobId={highlightedQuestionIds ? jobId ?? null : null}
      highlightedSavedCount={highlightedSavedCount}
      initialSelectedSource={marketSlug ? 'from_community' : 'all'}
      marketMenuSlug={marketSlug ?? null}
      marketMenuTitle={marketMenuTitle}
    />
  )
}
