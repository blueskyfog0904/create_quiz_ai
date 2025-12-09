import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { DevicesClient } from './devices-client'

export default async function DevicesPage() {
  const user = await requireAuth()
  const supabase = await createClient()
  
  // Fetch user sessions
  const { data: sessions } = await supabase
    .from('user_sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('last_active', { ascending: false })

  return (
    <DevicesClient 
      sessions={sessions || []} 
      userId={user.id}
    />
  )
}


