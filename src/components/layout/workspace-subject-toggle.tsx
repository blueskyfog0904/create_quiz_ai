'use client'

import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DEFAULT_WORKSPACE_SUBJECT, isSubjectFacingPath, isWorkspaceSubject, parseWorkspaceSubjectFromPath, stripWorkspacePrefix, type WorkspaceSubject, withWorkspacePrefix } from '@/lib/workspace-subject'
import { workspaceHref } from '@/lib/workspace-routes'
import { cn } from '@/lib/utils'

function buildToggleTarget(pathname: string, searchParams: URLSearchParams, targetSubject: WorkspaceSubject) {
  const currentSubject = parseWorkspaceSubjectFromPath(pathname)
  const stripped = stripWorkspacePrefix(pathname)

  if (pathname === '/' && !searchParams.get('subject')) {
    return workspaceHref(targetSubject, 'home')
  }

  if (currentSubject || isSubjectFacingPath(stripped.scopedPath)) {
    const nextParams = new URLSearchParams(searchParams.toString())
    nextParams.delete('subject')
    const nextPath = stripped.scopedPath === '/' ? workspaceHref(targetSubject, 'home') : withWorkspacePrefix(targetSubject, stripped.scopedPath)
    const nextQuery = nextParams.toString()
    return nextQuery ? `${nextPath}?${nextQuery}` : nextPath
  }

  return workspaceHref(targetSubject, 'home')
}

export function WorkspaceSubjectToggle({ className }: { className?: string }) {
  const pathname = usePathname() || '/'
  const searchParams = useSearchParams()
  const router = useRouter()

  const currentSubject = useMemo<WorkspaceSubject>(() => {
    const pathnameSubject = parseWorkspaceSubjectFromPath(pathname)
    if (pathnameSubject) {
      return pathnameSubject
    }

    const querySubject = searchParams.get('subject')
    return isWorkspaceSubject(querySubject) ? querySubject : DEFAULT_WORKSPACE_SUBJECT
  }, [pathname, searchParams])

  const handleSwitch = (targetSubject: WorkspaceSubject) => {
    if (targetSubject === currentSubject) {
      return
    }

    router.push(buildToggleTarget(pathname, new URLSearchParams(searchParams.toString()), targetSubject))
  }

  return (
    <div className={cn('inline-flex items-center rounded-full border bg-white p-1 shadow-sm', className)}>
      <Button
        type="button"
        variant={currentSubject === 'english' ? 'default' : 'ghost'}
        size="sm"
        className="rounded-full px-4"
        onClick={() => handleSwitch('english')}
      >
        영어
      </Button>
      <Button
        type="button"
        variant={currentSubject === 'korean' ? 'default' : 'ghost'}
        size="sm"
        className="rounded-full px-4"
        onClick={() => handleSwitch('korean')}
      >
        국어
      </Button>
    </div>
  )
}
