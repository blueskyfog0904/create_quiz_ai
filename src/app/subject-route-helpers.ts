import { notFound } from 'next/navigation'
import { isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'

export type RouteSearchParamValue = string | string[] | undefined
export type RouteSearchParams = Record<string, RouteSearchParamValue>

interface WorkspaceRouteParam {
  workspaceSubject: string
}

export async function resolveWorkspaceRouteParams<T extends WorkspaceRouteParam>(
  paramsPromise: Promise<T>
): Promise<{
  workspaceSubject: WorkspaceSubject
  routeParams: Omit<T, 'workspaceSubject'>
}> {
  const params = await paramsPromise
  const { workspaceSubject, ...routeParams } = params

  if (!isWorkspaceSubject(workspaceSubject)) {
    notFound()
  }

  return {
    workspaceSubject,
    routeParams: routeParams as Omit<T, 'workspaceSubject'>,
  }
}

export async function withWorkspaceSubjectSearchParams<T extends RouteSearchParams>(
  workspaceSubject: WorkspaceSubject,
  searchParams?: Promise<T>
): Promise<T & { subject: WorkspaceSubject }> {
  const resolvedSearchParams = searchParams ? await searchParams : ({} as T)
  return {
    ...resolvedSearchParams,
    subject: workspaceSubject,
  }
}
