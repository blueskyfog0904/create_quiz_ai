import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { PurchasedClient } from './purchased-client'

export default async function PurchasedPage() {
  await requireAuth()
  const supabase = await createClient()

  // Fetch questions - only user's own AI generated or purchased from community
  // Exclude admin_uploaded questions (those belong to the question bank)
  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('*, problem_types(type_name)')
    .in('source', ['ai_generated', 'from_community'])
    .order('created_at', { ascending: false })

  if (questionsError) {
    console.error("Error fetching questions:", questionsError)
  }

  // Fetch problem types
  const { data: problemTypes, error: typesError } = await supabase
    .from('problem_types')
    .select('id, type_name')
    .eq('is_active', true)
    .order('type_name')

  if (typesError) {
    console.error("Error fetching problem types:", typesError)
  }

  // Get unique grade levels from questions
  const gradeLevels = Array.from(
    new Set(questions?.map(q => q.grade_level).filter(Boolean))
  ).sort()

  // Get unique difficulties from questions
  const difficulties = Array.from(
    new Set(questions?.map(q => q.difficulty).filter(Boolean))
  ).sort()

  return (
    <PurchasedClient 
      questions={questions || []} 
      problemTypes={problemTypes || []} 
      gradeLevels={gradeLevels}
      difficulties={difficulties}
    />
  )
}


