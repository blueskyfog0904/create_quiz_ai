import { parseWorkspaceSubjectFromPath, stripWorkspacePrefix, withWorkspacePrefix } from '@/lib/workspace-subject'

export function getWorkspaceHomePath(path: string) {
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
