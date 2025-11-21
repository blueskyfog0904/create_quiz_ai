import { createClient } from '@/lib/supabase/server'
import ProblemTypesClient from './problem-types-client'
import { redirect } from 'next/navigation'

export default async function ProblemTypesPage() {
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
    // Redirect to home or show unauthorized
    redirect('/')
    // Alternatively, return an unauthorized UI
    // return <div>Unauthorized Access</div>
  }

  const { data: types } = await supabase
    .from('problem_types')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">문제 유형 관리</h1>
      <ProblemTypesClient initialTypes={types || []} />
    </div>
  )
}

