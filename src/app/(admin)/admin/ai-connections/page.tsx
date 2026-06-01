import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AIConnectionsClient from './ai-connections-client'

export default async function AIConnectionsPage() {
  const supabase = await createClient()
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
      <AIConnectionsClient />
    </div>
  )
}
