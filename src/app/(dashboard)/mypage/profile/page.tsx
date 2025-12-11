import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import { ProfileClient } from './profile-client'

export default async function ProfilePage() {
  const user = await requireAuth()
  const supabase = await createClient()
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return (
    <ProfileClient 
      profile={profile} 
      email={user.email || ''} 
    />
  )
}


