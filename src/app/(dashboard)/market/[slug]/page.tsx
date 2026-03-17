import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PurchasedClient } from '@/app/(dashboard)/library/purchased/purchased-client'

interface MarketMenuPageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function MarketMenuPage({ params }: MarketMenuPageProps) {
  await requireAuth()
  const { slug } = await params
  const supabase = await createClient()

  const { data: marketEntry, error: marketEntryError } = await supabase
    .from('market_menu_entries')
    .select('slug, title')
    .eq('slug', slug)
    .is('deleted_at', null)
    .eq('is_active', true)
    .eq('is_visible', true)
    .maybeSingle()

  if (marketEntryError) {
    throw new Error(marketEntryError.message)
  }

  if (!marketEntry) {
    notFound()
  }

  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('*, problem_types(type_name)')
    .in('source', ['ai_generated', 'from_community'])
    .order('created_at', { ascending: false })

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
      initialSelectedSource="from_community"
      marketMenuSlug={marketEntry.slug}
      marketMenuTitle={marketEntry.title}
    />
  )
}
