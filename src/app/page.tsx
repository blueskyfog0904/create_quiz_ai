import { createClient } from '@/lib/supabase/server'
import { MainLanding } from '@/components/features/landing/MainLanding'
import { WorkspaceLanding } from '@/components/features/landing/WorkspaceLanding'
import { assertWorkspaceSubject } from '@/lib/workspace-subject'

interface HomePageProps {
  searchParams?: Promise<{
    subject?: string
  }>
}

export default async function Home({ searchParams }: HomePageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const subject = resolvedSearchParams?.subject ? assertWorkspaceSubject(resolvedSearchParams.subject) : null

  if (subject) {
    return <WorkspaceLanding subject={subject} isLoggedIn={Boolean(user)} />
  }

  return <MainLanding />
}
