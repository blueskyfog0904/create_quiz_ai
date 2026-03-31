import {
  DEFAULT_WORKSPACE_SUBJECT,
  isWorkspaceSubject,
  parseWorkspaceSubjectFromPath,
  type WorkspaceSubject,
} from '@/lib/workspace-subject'

export { DEFAULT_WORKSPACE_SUBJECT as DEFAULT_GENERATE_WORKSPACE_SUBJECT }
export type { WorkspaceSubject }

export type WorkspaceScoped<T> = T & {
  workspace_subject: WorkspaceSubject
}

function parseWorkspaceSubjectFromReferer(referer: string | null | undefined) {
  if (!referer) {
    return null
  }

  try {
    return parseWorkspaceSubjectFromPath(new URL(referer).pathname)
  } catch {
    return null
  }
}

export function resolveGenerateWorkspaceSubject(input?: {
  workspaceSubject?: string | null
  pathname?: string | null
  referer?: string | null
}) {
  if (isWorkspaceSubject(input?.workspaceSubject)) {
    return input.workspaceSubject
  }

  const pathnameSubject = input?.pathname
    ? parseWorkspaceSubjectFromPath(input.pathname)
    : null

  if (pathnameSubject) {
    return pathnameSubject
  }

  return parseWorkspaceSubjectFromReferer(input?.referer) ?? DEFAULT_WORKSPACE_SUBJECT
}
