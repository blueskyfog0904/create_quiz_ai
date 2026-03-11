export interface HeaderMenuChildItem {
  id: string
  title: string
  href: string
  isActive: boolean
}

export interface HeaderMenuItem {
  id: string
  title: string
  href?: string
  isActive: boolean
  children: HeaderMenuChildItem[]
}

export interface HeaderNavigationConfig {
  logoText: string
  items: HeaderMenuItem[]
}

export interface HeaderNavigationFlatRow {
  id: string
  title: string
  href?: string
  depth: 1 | 2
  parentId: string | null
  parentTitle: string | null
  childCount: number
  isActive: boolean
}

export const HEADER_NAVIGATION_SETTING_KEY = 'header_navigation'
export const MAX_LOGO_TEXT_LENGTH = 30
export const MAX_MENU_TITLE_LENGTH = 30

function normalizeInternalHeaderHref(value: string) {
  if (!value.startsWith('/')) return value
  if (value === '/') return '/'

  const normalized = value.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

function isInternalHeaderHref(value?: string): value is string {
  return typeof value === 'string' && value.startsWith('/')
}

export const DEFAULT_HEADER_NAVIGATION_CONFIG: HeaderNavigationConfig = {
  logoText: 'AI영어문제팩토리',
  items: [
    {
      id: 'menu-generate',
      title: 'AI문제생성',
      href: '/generate',
      isActive: true,
      children: [],
    },
    {
      id: 'menu-bank',
      title: '문제은행',
      href: '/bank',
      isActive: true,
      children: [],
    },
    {
      id: 'menu-pricing',
      title: '요금제',
      href: '/pricing',
      isActive: true,
      children: [],
    },
  ],
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBoolean(value: unknown, fallback = true) {
  return typeof value === 'boolean' ? value : fallback
}

export function isSafeHeaderHref(value: string) {
  return value.startsWith('/') || /^https?:\/\//i.test(value)
}

export function resolveHeaderMenuHref(parentHref: string | undefined, href: string) {
  if (!isInternalHeaderHref(parentHref) || !isInternalHeaderHref(href)) {
    return href
  }

  const normalizedParentHref = normalizeInternalHeaderHref(parentHref)
  const normalizedHref = normalizeInternalHeaderHref(href)

  if (normalizedParentHref === '/' || normalizedHref === normalizedParentHref) {
    return normalizedHref
  }

  if (normalizedHref.startsWith(`${normalizedParentHref}/`)) {
    return normalizedHref
  }

  return `${normalizedParentHref}${normalizedHref === '/' ? '' : normalizedHref}`
}

function normalizeChildItem(rawChild: unknown, fallbackIndex: number): HeaderMenuChildItem | null {
  if (!rawChild || typeof rawChild !== 'object') return null

  const child = rawChild as Partial<HeaderMenuChildItem>
  const title = normalizeText(child.title)
  const href = normalizeText(child.href)

  if (!title || title.length > MAX_MENU_TITLE_LENGTH) return null
  if (!href || !isSafeHeaderHref(href)) return null

  return {
    id: normalizeText(child.id) || `child-${fallbackIndex}-${crypto.randomUUID()}`,
    title,
    href,
    isActive: normalizeBoolean(child.isActive),
  }
}

function normalizeParentItem(rawItem: unknown, fallbackIndex: number): HeaderMenuItem | null {
  if (!rawItem || typeof rawItem !== 'object') return null

  const item = rawItem as Partial<HeaderMenuItem>
  const title = normalizeText(item.title)
  if (!title || title.length > MAX_MENU_TITLE_LENGTH) return null

  const rawChildren = Array.isArray(item.children) ? item.children : []
  const children = rawChildren
    .map((child, index) => normalizeChildItem(child, index))
    .filter((child): child is HeaderMenuChildItem => child !== null)

  const href = normalizeText(item.href)
  const normalizedHref = href && isSafeHeaderHref(href)
    ? href
    : undefined

  if (children.length === 0 && !normalizedHref) return null

  return {
    id: normalizeText(item.id) || `menu-${fallbackIndex}-${crypto.randomUUID()}`,
    title,
    href: normalizedHref,
    isActive: normalizeBoolean(item.isActive),
    children,
  }
}

export function normalizeHeaderNavigationConfig(rawValue: unknown): HeaderNavigationConfig {
  if (!rawValue || typeof rawValue !== 'object') {
    return DEFAULT_HEADER_NAVIGATION_CONFIG
  }

  const rawConfig = rawValue as Partial<HeaderNavigationConfig>
  const logoText = normalizeText(rawConfig.logoText).slice(0, MAX_LOGO_TEXT_LENGTH)
  const hasExplicitItems = Array.isArray(rawConfig.items)
  const rawItems = Array.isArray(rawConfig.items) ? rawConfig.items : []

  const items = rawItems
    .map((item, index) => normalizeParentItem(item, index))
    .filter((item): item is HeaderMenuItem => item !== null)

  return {
    logoText: logoText || DEFAULT_HEADER_NAVIGATION_CONFIG.logoText,
    items: hasExplicitItems ? items : DEFAULT_HEADER_NAVIGATION_CONFIG.items,
  }
}

export function validateHeaderNavigationConfig(config: HeaderNavigationConfig) {
  const logoText = normalizeText(config.logoText)
  if (!logoText) {
    throw new Error('로고 문구를 입력해주세요.')
  }

  if (logoText.length > MAX_LOGO_TEXT_LENGTH) {
    throw new Error(`로고 문구는 ${MAX_LOGO_TEXT_LENGTH}자 이하로 입력해주세요.`)
  }

  if (!Array.isArray(config.items)) {
    throw new Error('메뉴 형식이 올바르지 않습니다.')
  }

  config.items.forEach((item) => {
    const title = normalizeText(item.title)
    const href = normalizeText(item.href)

    if (!title) {
      throw new Error('메뉴명은 비워둘 수 없습니다.')
    }

    if (title.length > MAX_MENU_TITLE_LENGTH) {
      throw new Error(`메뉴명은 ${MAX_MENU_TITLE_LENGTH}자 이하로 입력해주세요.`)
    }

    if (href && !isSafeHeaderHref(href)) {
      throw new Error(`'${title}' 메뉴의 링크 형식이 올바르지 않습니다.`)
    }

    if (item.children.length === 0) {
      if (!href) {
        throw new Error(`'${title}' 메뉴의 링크를 입력해주세요.`)
      }
    }

    item.children.forEach((child) => {
      const childTitle = normalizeText(child.title)
      const childHref = normalizeText(child.href)

      if (!childTitle) {
        throw new Error('하위 메뉴명은 비워둘 수 없습니다.')
      }

      if (childTitle.length > MAX_MENU_TITLE_LENGTH) {
        throw new Error(`하위 메뉴명은 ${MAX_MENU_TITLE_LENGTH}자 이하로 입력해주세요.`)
      }

      if (!childHref || !isSafeHeaderHref(childHref)) {
        throw new Error(`'${childTitle}' 하위 메뉴의 링크 형식이 올바르지 않습니다.`)
      }
    })
  })
}

export function getActiveHeaderNavigationItems(items: HeaderMenuItem[]): HeaderMenuItem[] {
  return items
    .filter((item) => item.isActive)
    .map((item) => ({
      ...item,
      children: item.children
        .filter((child) => child.isActive)
        .map((child) => ({
          ...child,
          href: resolveHeaderMenuHref(item.href, child.href),
        })),
    }))
}

export function flattenHeaderNavigationItems(items: HeaderMenuItem[]): HeaderNavigationFlatRow[] {
  return items.flatMap((item) => {
    const parentRow: HeaderNavigationFlatRow = {
      id: item.id,
      title: item.title,
      href: item.href,
      depth: 1,
      parentId: null,
      parentTitle: null,
      childCount: item.children.length,
      isActive: item.isActive,
    }

    const childRows: HeaderNavigationFlatRow[] = item.children.map((child) => ({
      id: child.id,
      title: child.title,
      href: resolveHeaderMenuHref(item.href, child.href),
      depth: 2,
      parentId: item.id,
      parentTitle: item.title,
      childCount: 0,
      isActive: child.isActive,
    }))

    return [parentRow, ...childRows]
  })
}
