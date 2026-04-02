import { createClient } from '@/lib/supabase/server'
import { WorkspaceLanding } from '@/components/features/landing/WorkspaceLanding'

export default async function KoreanHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return <WorkspaceLanding subject="korean" isLoggedIn={Boolean(user)} />
}
