import { createClient } from '@/lib/supabase/server'
import { WorkspaceLanding } from '@/components/features/landing/WorkspaceLanding'

export default async function EnglishHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return <WorkspaceLanding subject="english" isLoggedIn={Boolean(user)} />
}
