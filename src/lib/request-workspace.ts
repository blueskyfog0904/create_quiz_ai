import { cookies, headers } from 'next/headers'
import {
  DEFAULT_WORKSPACE_SUBJECT,
  isWorkspaceSubject,
  parseWorkspaceSubjectFromPath,
  type WorkspaceSubject,
} from '@/lib/workspace-subject'

export const PREFERRED_WORKSPACE_COOKIE = 'preferred_workspace'
export const WORKSPACE_SUBJECT_HEADER = 'x-workspace-subject'
export const WORKSPACE_HEADER_MODE_HEADER = 'x-workspace-header-mode'
export const WORKSPACE_SCOPED_PATH_HEADER = 'x-workspace-scoped-path'

export type WorkspaceHeaderMode = 'root-neutral' | 'subject'

function isWorkspaceHeaderMode(value: string | null | undefined): value is WorkspaceHeaderMode {
  return value === 'root-neutral' || value === 'subject'
}

export async function getRequestWorkspaceContext(): Promise<{
  workspaceSubject: WorkspaceSubject
  headerMode: WorkspaceHeaderMode
  scopedPath: string
}> {
  const headerStore = await headers()
  const cookieStore = await cookies()
  const headerModeValue = headerStore.get(WORKSPACE_HEADER_MODE_HEADER)
  const scopedPath = headerStore.get(WORKSPACE_SCOPED_PATH_HEADER) ?? '/'

  const headerMode: WorkspaceHeaderMode = isWorkspaceHeaderMode(headerModeValue)
    ? headerModeValue
    : 'subject'

  const headerSubject = headerStore.get(WORKSPACE_SUBJECT_HEADER)
  if (isWorkspaceSubject(headerSubject)) {
    return {
      workspaceSubject: headerSubject,
      headerMode,
      scopedPath,
    }
  }

  const cookieSubject = cookieStore.get(PREFERRED_WORKSPACE_COOKIE)?.value
  if (isWorkspaceSubject(cookieSubject)) {
    return {
      workspaceSubject: cookieSubject,
      headerMode,
      scopedPath,
    }
  }

  const referer = headerStore.get('referer')
  if (referer) {
    try {
      const refererSubject = parseWorkspaceSubjectFromPath(new URL(referer).pathname)
      if (refererSubject) {
        return {
          workspaceSubject: refererSubject,
          headerMode,
          scopedPath,
        }
      }
    } catch {
      // Ignore malformed referers
    }
  }

  return {
    workspaceSubject: DEFAULT_WORKSPACE_SUBJECT,
    headerMode,
    scopedPath,
  }
}

export async function getRequestWorkspaceSubject(): Promise<WorkspaceSubject> {
  const context = await getRequestWorkspaceContext()
  return context.workspaceSubject
}
