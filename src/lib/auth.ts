import { createClient } from '@/lib/supabase/server'
import { parseWorkspaceSubjectFromPath, stripWorkspacePrefix, withWorkspacePrefix } from '@/lib/workspace-subject'
import { redirect } from 'next/navigation'

function getWorkspaceHomePath(path: string) {
  const subject = parseWorkspaceSubjectFromPath(path)
  return subject ? withWorkspacePrefix(subject, '/') : '/'
}

export function normalizeAuthNextPath(path: string | null | undefined) {
  if (!path) {
    return '/'
  }

  const trimmed = path.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/'
  }

  try {
    const url = new URL(trimmed, 'http://localhost')
    const pathname = url.pathname
    const scopedPath = stripWorkspacePrefix(pathname).scopedPath

    if (pathname === '/login' || pathname === '/signup' || scopedPath === '/login' || scopedPath === '/signup') {
      return getWorkspaceHomePath(pathname)
    }

    return `${pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

export function buildAuthRedirectPath(nextPath?: string | null, authPath: '/login' | '/signup' = '/login') {
  const next = normalizeAuthNextPath(nextPath)
  return next === '/' ? authPath : `${authPath}?${new URLSearchParams({ next }).toString()}`
}

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
