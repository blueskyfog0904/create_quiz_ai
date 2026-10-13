import { resolveWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'

export const ADMIN_SUBJECT_QUERY_KEY = 'subject'

// 관리자 화면은 주소에 과목이 없으면(처음 들어올 때) 국어로 시작한다
export const DEFAULT_ADMIN_WORKSPACE_SUBJECT: WorkspaceSubject = 'korean'

export function resolveAdminWorkspaceSubject(value: string | null | undefined): WorkspaceSubject {
  return resolveWorkspaceSubject(value, DEFAULT_ADMIN_WORKSPACE_SUBJECT)
}

export function withAdminWorkspaceSubject(href: string, workspaceSubject: WorkspaceSubject) {
  if (!href.startsWith('/')) {
    return href
  }

  const url = new URL(href, 'http://localhost')
  url.searchParams.set(ADMIN_SUBJECT_QUERY_KEY, workspaceSubject)
  return `${url.pathname}${url.search}`
}
