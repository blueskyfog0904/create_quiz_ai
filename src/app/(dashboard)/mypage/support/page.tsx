import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { SupportClient } from './support-client'

export default async function SupportPage() {
  const user = await requireAuth()
  const supabase = await createClient()
  
  // Fetch user's support tickets
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <SupportClient 
      tickets={tickets || []} 
      userId={user.id}
    />
  )
}


