import { DEFAULT_WORKSPACE_SUBJECT, resolveWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'

export const ADMIN_SUBJECT_QUERY_KEY = 'subject'

export function resolveAdminWorkspaceSubject(value: string | null | undefined): WorkspaceSubject {
  return resolveWorkspaceSubject(value, DEFAULT_WORKSPACE_SUBJECT)
}

export function withAdminWorkspaceSubject(href: string, workspaceSubject: WorkspaceSubject) {
  if (!href.startsWith('/')) {
    return href
  }

  const url = new URL(href, 'http://localhost')
  url.searchParams.set(ADMIN_SUBJECT_QUERY_KEY, workspaceSubject)
  return `${url.pathname}${url.search}`
}
