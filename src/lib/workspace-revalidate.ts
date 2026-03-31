import { workspaceHref, type WorkspaceRouteKey, type WorkspaceRouteParams } from '@/lib/workspace-routes'
import { DEFAULT_WORKSPACE_SUBJECT, WORKSPACE_SUBJECTS, type WorkspaceSubject } from '@/lib/workspace-subject'

export interface WorkspaceRevalidateTarget {
  path: string
  type?: 'layout' | 'page'
}

const ROUTE_REVALIDATE_MAP: Record<WorkspaceRouteKey, WorkspaceRevalidateTarget[]> = {
  home: [{ path: '/', type: 'layout' }],
  generate: [{ path: '/generate', type: 'layout' }],
  generatePersonal: [{ path: '/generate/personal', type: 'layout' }],
  generateMulti: [{ path: '/generate/multi', type: 'layout' }],
  generateType: [{ path: '/generate/:typeId', type: 'page' }],
  generateBoard: [{ path: '/generate/boards/:slug', type: 'layout' }],
  generateBoardPost: [{ path: '/generate/boards/:slug/posts/:postId', type: 'page' }],
  generateBoardJob: [{ path: '/generate/boards/:slug/posts/:postId/jobs/:jobId', type: 'page' }],
  bank: [{ path: '/bank', type: 'layout' }],
  libraryPurchased: [{ path: '/library/purchased', type: 'layout' }],
  libraryExamPapers: [{ path: '/library/exam-papers', type: 'layout' }],
  libraryExamPaper: [{ path: '/library/exam-papers/:id', type: 'page' }],
  libraryMarket: [{ path: '/library/market', type: 'layout' }],
  libraryMypassages: [{ path: '/library/mypassages', type: 'layout' }],
  market: [{ path: '/market', type: 'layout' }],
  marketCategory: [{ path: '/market/:slug', type: 'layout' }],
  marketItem: [{ path: '/market/:slug/items/:id', type: 'page' }],
}

function fillPathTemplate(pathTemplate: string, params: WorkspaceRouteParams) {
  return pathTemplate
    .replace(':typeId', params.typeId ?? ':typeId')
    .replace(':slug', params.slug ?? ':slug')
    .replace(':postId', params.postId ?? ':postId')
    .replace(':jobId', params.jobId ?? ':jobId')
    .replace(':id', params.id ?? ':id')
}

export function workspaceRevalidatePaths(
  subject: WorkspaceSubject,
  routeKey: WorkspaceRouteKey,
  params: WorkspaceRouteParams = {}
): WorkspaceRevalidateTarget[] {
  const targets = ROUTE_REVALIDATE_MAP[routeKey] ?? []

  return targets.map((target) => {
    const concretePath = fillPathTemplate(target.path, params)
    const scopedPath = concretePath === '/'
      ? workspaceHref(subject, 'home')
      : `${workspaceHref(subject, 'home')}${concretePath === '/' ? '' : concretePath}`.replace(`/${subject}/${subject}`, `/${subject}`)

    return {
      path: scopedPath,
      type: target.type,
    }
  })
}

export function workspaceRevalidatePair(
  routeKey: WorkspaceRouteKey,
  params: WorkspaceRouteParams = {}
) {
  return WORKSPACE_SUBJECTS.flatMap((subject) => workspaceRevalidatePaths(subject, routeKey, params))
}

export function defaultWorkspaceRevalidatePaths(
  routeKey: WorkspaceRouteKey,
  params: WorkspaceRouteParams = {}
) {
  return workspaceRevalidatePaths(DEFAULT_WORKSPACE_SUBJECT, routeKey, params)
}
