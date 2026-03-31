import {
  DEFAULT_WORKSPACE_SUBJECT,
  type WorkspaceSubject,
  normalizePathname,
  stripWorkspacePrefix,
  withWorkspacePrefix,
  isSubjectFacingPath,
} from '@/lib/workspace-subject'

export type WorkspaceRouteKey =
  | 'home'
  | 'generate'
  | 'generatePersonal'
  | 'generateMulti'
  | 'generateType'
  | 'generateBoard'
  | 'generateBoardPost'
  | 'generateBoardJob'
  | 'bank'
  | 'libraryPurchased'
  | 'libraryExamPapers'
  | 'libraryExamPaper'
  | 'libraryMarket'
  | 'libraryMypassages'
  | 'market'
  | 'marketCategory'
  | 'marketItem'

export interface WorkspaceRouteParams {
  typeId?: string
  slug?: string
  postId?: string
  jobId?: string
  id?: string
}

function requireParam(value: string | undefined, paramName: string) {
  if (!value) {
    throw new Error(`Missing route param: ${paramName}`)
  }

  return encodeURIComponent(value)
}

export function workspaceHref(
  subject: WorkspaceSubject,
  routeKey: WorkspaceRouteKey,
  params: WorkspaceRouteParams = {}
) {
  switch (routeKey) {
    case 'home':
      return withWorkspacePrefix(subject, '/')
    case 'generate':
      return withWorkspacePrefix(subject, '/generate')
    case 'generatePersonal':
      return withWorkspacePrefix(subject, '/generate/personal')
    case 'generateMulti':
      return withWorkspacePrefix(subject, '/generate/multi')
    case 'generateType':
      return withWorkspacePrefix(subject, `/generate/${requireParam(params.typeId, 'typeId')}`)
    case 'generateBoard':
      return withWorkspacePrefix(subject, `/generate/boards/${requireParam(params.slug, 'slug')}`)
    case 'generateBoardPost':
      return withWorkspacePrefix(subject, `/generate/boards/${requireParam(params.slug, 'slug')}/posts/${requireParam(params.postId, 'postId')}`)
    case 'generateBoardJob':
      return withWorkspacePrefix(subject, `/generate/boards/${requireParam(params.slug, 'slug')}/posts/${requireParam(params.postId, 'postId')}/jobs/${requireParam(params.jobId, 'jobId')}`)
    case 'bank':
      return withWorkspacePrefix(subject, '/bank')
    case 'libraryPurchased':
      return withWorkspacePrefix(subject, '/library/purchased')
    case 'libraryExamPapers':
      return withWorkspacePrefix(subject, '/library/exam-papers')
    case 'libraryExamPaper':
      return withWorkspacePrefix(subject, `/library/exam-papers/${requireParam(params.id, 'id')}`)
    case 'libraryMarket':
      return withWorkspacePrefix(subject, '/library/market')
    case 'libraryMypassages':
      return withWorkspacePrefix(subject, '/library/mypassages')
    case 'market':
      return withWorkspacePrefix(subject, '/market')
    case 'marketCategory':
      return withWorkspacePrefix(subject, `/market/${requireParam(params.slug, 'slug')}`)
    case 'marketItem':
      return withWorkspacePrefix(subject, `/market/${requireParam(params.slug, 'slug')}/items/${requireParam(params.id, 'id')}`)
    default:
      return withWorkspacePrefix(subject, '/')
  }
}

export function legacyToWorkspaceRedirect(pathname: string, subject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT) {
  const normalized = normalizePathname(pathname)

  if (!isSubjectFacingPath(normalized)) {
    return null
  }

  const stripped = stripWorkspacePrefix(normalized)
  if (stripped.subject) {
    return normalized
  }

  return withWorkspacePrefix(subject, stripped.scopedPath)
}

export function mapWorkspaceToggleTarget(
  currentPathname: string,
  targetSubject: WorkspaceSubject
) {
  const normalized = normalizePathname(currentPathname)
  const stripped = stripWorkspacePrefix(normalized)

  if (!isSubjectFacingPath(normalized)) {
    return null
  }

  return withWorkspacePrefix(targetSubject, stripped.scopedPath)
}
