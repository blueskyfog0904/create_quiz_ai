import { workspaceHref } from '@/lib/workspace-routes'
import {
  DEFAULT_WORKSPACE_SUBJECT,
  parseWorkspaceSubjectFromPath,
  type WorkspaceSubject,
} from '@/lib/workspace-subject'

export function resolvePassageWorkspaceSubject(
  pathname?: string | null,
  explicitSubject?: WorkspaceSubject | null
) {
  if (explicitSubject) {
    return explicitSubject
  }

  return parseWorkspaceSubjectFromPath(pathname ?? '') ?? DEFAULT_WORKSPACE_SUBJECT
}

export function buildPassageLibraryHref(
  pathname?: string | null,
  explicitSubject?: WorkspaceSubject | null
) {
  return workspaceHref(resolvePassageWorkspaceSubject(pathname, explicitSubject), 'libraryMypassages')
}
