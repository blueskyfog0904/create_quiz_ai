import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { BankClient } from './bank-client'

export default async function BankPage() {
  await requireAuth()
  const supabase = await createClient()

  // Fetch questions
  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('*')
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
    <BankClient 
      questions={questions || []} 
      problemTypes={problemTypes || []} 
      gradeLevels={gradeLevels}
      difficulties={difficulties}
    />
  )
}

