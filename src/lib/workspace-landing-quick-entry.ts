import type { HeaderMenuItem } from './header-navigation'
import type { WorkspaceSubject } from './workspace-subject'

interface WorkspaceLandingQuickEntryTargets {
  primaryLabel: string
  primaryHref: string
  secondaryLabel: string | null
  secondaryHref: string | null
}

function getFirstChildHref(items: HeaderMenuItem[], parentHref: string) {
  return items.find((item) => item.href === parentHref)?.children[0]?.href ?? null
}

function withSubjectPrefix(subject: WorkspaceSubject, pathname: string) {
  const normalized = pathname === '/' ? '/' : pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
  return normalized === '/' ? `/${subject}` : `/${subject}${normalized}`
}

export function resolveWorkspaceLandingQuickEntryTargets(
  subject: WorkspaceSubject,
  items: HeaderMenuItem[]
): WorkspaceLandingQuickEntryTargets {
  if (subject === 'korean') {
    const marketChildHref = getFirstChildHref(items, '/market') ?? '/market'

    return {
      primaryLabel: '국어문제마켓 서비스 들어가기',
      primaryHref: withSubjectPrefix(subject, marketChildHref),
      secondaryLabel: null,
      secondaryHref: null,
    }
  }

  const generateChildHref = getFirstChildHref(items, '/generate') ?? '/generate'
  const marketChildHref = getFirstChildHref(items, '/market') ?? '/market'

  return {
    primaryLabel: '영어문제생성 서비스 들어가기',
    primaryHref: withSubjectPrefix(subject, generateChildHref),
    secondaryLabel: '영어문제마켓 서비스 들어가기',
    secondaryHref: withSubjectPrefix(subject, marketChildHref),
  }
}
