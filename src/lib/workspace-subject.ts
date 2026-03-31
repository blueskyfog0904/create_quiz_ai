export const WORKSPACE_SUBJECTS = ['english', 'korean'] as const
export type WorkspaceSubject = (typeof WORKSPACE_SUBJECTS)[number]

export const DEFAULT_WORKSPACE_SUBJECT: WorkspaceSubject = 'english'

export function isWorkspaceSubject(value: string | null | undefined): value is WorkspaceSubject {
  return typeof value === 'string' && WORKSPACE_SUBJECTS.includes(value as WorkspaceSubject)
}

export function assertWorkspaceSubject(value: string | null | undefined): WorkspaceSubject {
  if (!isWorkspaceSubject(value)) {
    throw new Error(`Unsupported workspace subject: ${value ?? 'unknown'}`)
  }

  return value
}

export function getWorkspacePrefix(subject: WorkspaceSubject) {
  return `/${subject}`
}

export function normalizePathname(pathname: string) {
  if (!pathname) return '/'
  const normalized = pathname.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

export function parseWorkspaceSubjectFromPath(pathname: string): WorkspaceSubject | null {
  const normalized = normalizePathname(pathname)
  const firstSegment = normalized.split('/').filter(Boolean)[0] ?? null
  return isWorkspaceSubject(firstSegment) ? firstSegment : null
}

export function stripWorkspacePrefix(pathname: string) {
  const normalized = normalizePathname(pathname)
  const subject = parseWorkspaceSubjectFromPath(normalized)

  if (!subject) {
    return {
      subject: null,
      scopedPath: normalized,
    }
  }

  const withoutPrefix = normalized.slice(getWorkspacePrefix(subject).length)
  return {
    subject,
    scopedPath: withoutPrefix ? normalizePathname(withoutPrefix) : '/',
  }
}

export function withWorkspacePrefix(subject: WorkspaceSubject, pathname: string) {
  const normalized = normalizePathname(pathname)
  if (normalized === '/') {
    return getWorkspacePrefix(subject)
  }

  return `${getWorkspacePrefix(subject)}${normalized}`
}

export function isSubjectFacingPath(pathname: string) {
  const normalized = stripWorkspacePrefix(pathname).scopedPath

  return [
    '/generate',
    '/bank',
    '/market',
    '/library/purchased',
    '/library/exam-papers',
    '/library/market',
    '/library/mypassages',
    '/exam-papers',
  ].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))
}
