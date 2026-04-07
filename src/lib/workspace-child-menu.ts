export interface WorkspaceChildMenuItemInput {
  id: string
  title: string
  href: string
  isActive: boolean
  showDividerBefore?: boolean
}

export interface WorkspaceChildMenuGroupInput {
  parentTitle: string
  parentHref?: string
  items: WorkspaceChildMenuItemInput[]
  currentPath: string
  isItemActive?: (item: WorkspaceChildMenuItemInput, currentPath: string) => boolean
}

export interface WorkspaceChildMenuGroup {
  parent: {
    title: string
    href?: string
    clickable: false
  }
  defaultExpanded: true
  items: Array<{
    id: string
    title: string
    href: string
    clickable: true
    active: boolean
    showDividerBefore: boolean
  }>
}

function isPathActive(href: string, currentPath: string) {
  return currentPath === href || currentPath.startsWith(`${href}/`)
}

export function buildWorkspaceChildMenuGroup({
  parentTitle,
  parentHref,
  items,
  currentPath,
  isItemActive,
}: WorkspaceChildMenuGroupInput): WorkspaceChildMenuGroup {
  return {
    parent: {
      title: parentTitle,
      href: parentHref,
      clickable: false,
    },
    defaultExpanded: true,
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      href: item.href,
      clickable: true,
      active: isItemActive ? isItemActive(item, currentPath) : isPathActive(item.href, currentPath),
      showDividerBefore: Boolean(item.showDividerBefore),
    })),
  }
}
