import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { buildAuthRedirectPath, getWorkspaceHomePath, normalizeAuthNextPath } from '@/lib/auth-paths'

export async function getSession() {
  const supabase = await createClient()
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession()

    return { session, error }
  } catch (error) {
    return { session: null, error }
  }
}

export async function getUser() {
  const supabase = await createClient()
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    return { user, error }
  } catch (error) {
    return { user: null, error }
  }
}

export async function getProfile() {
  const supabase = await createClient()
  const { user } = await getUser()
  
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  return profile
}

export async function requireAuth(nextPath?: string | null) {
  const { user } = await getUser()
  if (!user) {
    redirect(buildAuthRedirectPath(nextPath))
  }
  return user
}

export async function requireAdmin(nextPath?: string | null) {
  const supabase = await createClient()
  const { user } = await getUser()
  
  if (!user) {
    redirect(buildAuthRedirectPath(nextPath))
  }
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  
  if (!profile?.is_admin) {
    redirect(getWorkspaceHomePath(normalizeAuthNextPath(nextPath)))
  }
  
  return user
}
