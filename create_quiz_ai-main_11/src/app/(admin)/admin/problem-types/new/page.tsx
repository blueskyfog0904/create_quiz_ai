import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ProblemTypeFormClient from './problem-type-form-client'

export default async function NewProblemTypePage() {
  const supabase = await createClient()
  
  // Check authentication and admin status
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    redirect('/')
  }

  return (
    <div className="container mx-auto py-8">
      <ProblemTypeFormClient />
    </div>
  )
}
