'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentProps } from 'react'
import {
  DEFAULT_WORKSPACE_SUBJECT,
  isSubjectFacingPath,
  parseWorkspaceSubjectFromPath,
  withWorkspacePrefix,
  type WorkspaceSubject,
} from '@/lib/workspace-subject'

interface WorkspaceLinkProps extends Omit<ComponentProps<typeof Link>, 'href'> {
  href: string
  subject?: WorkspaceSubject
}

function resolveWorkspaceHref(href: string, pathname: string, explicitSubject?: WorkspaceSubject) {
  if (!href.startsWith('/')) {
    return href
  }

  if (parseWorkspaceSubjectFromPath(href)) {
    return href
  }

  if (!isSubjectFacingPath(href)) {
    return href
  }

  const subject = explicitSubject ?? parseWorkspaceSubjectFromPath(pathname) ?? DEFAULT_WORKSPACE_SUBJECT
  return withWorkspacePrefix(subject, href)
}

export function WorkspaceLink({ href, subject, ...props }: WorkspaceLinkProps) {
  const pathname = usePathname() ?? '/'
  const resolvedHref = resolveWorkspaceHref(href, pathname, subject)

  return <Link href={resolvedHref} {...props} />
}
