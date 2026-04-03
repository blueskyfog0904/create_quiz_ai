import type { HeaderMenuChildItem } from '@/lib/header-navigation'

export interface WorkspaceSecondLevelMenuItem extends HeaderMenuChildItem {
  active: boolean
}

interface BuildWorkspaceSecondLevelMenuItemsInput {
  currentPath: string
  items: HeaderMenuChildItem[]
  reorderItems?: (items: HeaderMenuChildItem[]) => HeaderMenuChildItem[]
  isItemActive?: (item: HeaderMenuChildItem, currentPath: string) => boolean
}

function defaultIsItemActive(item: HeaderMenuChildItem, currentPath: string) {
  return currentPath === item.href || currentPath.startsWith(`${item.href}/`)
}

export function buildWorkspaceSecondLevelMenuItems({
  currentPath,
  items,
  reorderItems,
  isItemActive = defaultIsItemActive,
}: BuildWorkspaceSecondLevelMenuItemsInput): WorkspaceSecondLevelMenuItem[] {
  const orderedItems = reorderItems ? reorderItems(items) : items

  return orderedItems.map((item) => ({
    ...item,
    active: isItemActive(item, currentPath),
  }))
}
