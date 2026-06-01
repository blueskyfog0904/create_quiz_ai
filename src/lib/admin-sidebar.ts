import {
  BookOpen,
  Coins,
  CreditCard,
  Database,
  FileText,
  LayoutDashboard,
  LayoutPanelTop,
  MessageSquare,
  RefreshCcw,
  Settings,
  Upload,
  UserCog,
  Users,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import type { WorkspaceSubject } from '@/lib/workspace-settings'
import type { Json } from '@/types/supabase'

export const ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY = 'admin_sidebar_navigation'

export type AdminSidebarIconName =
  | 'layoutDashboard'
  | 'layoutPanelTop'
  | 'wandSparkles'
  | 'upload'
  | 'bookOpen'
  | 'settings'
  | 'database'
  | 'users'
  | 'userCog'
  | 'messageSquare'
  | 'creditCard'
  | 'coins'
  | 'refreshCcw'
  | 'fileText'

export interface AdminSidebarMenuItem {
  name: string
  href: string
  icon: AdminSidebarIconName
  exact?: boolean
}

export interface AdminSidebarNavigationConfig {
  items: string[]
}

export const ADMIN_QUESTION_BANK_MENU_HREFS = [
  '/admin/questions',
  '/admin/questions/upload',
  '/admin/question-bank/options',
  '/admin/question-bank/problem-types',
  '/admin/question-bank/backfill',
] as const

const ADMIN_QUESTION_BANK_MENU_HREF_SET = new Set<string>(ADMIN_QUESTION_BANK_MENU_HREFS)

export interface AdminSidebarMenuGroupNode {
  type: 'group'
  id: 'questionBank'
  name: string
  icon: AdminSidebarIconName
  items: AdminSidebarMenuItem[]
}

export interface AdminSidebarMenuItemNode {
  type: 'item'
  item: AdminSidebarMenuItem
}

export type AdminSidebarNavigationNode = AdminSidebarMenuGroupNode | AdminSidebarMenuItemNode

export const DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG: AdminSidebarNavigationConfig = {
  items: [
    '/admin',
    '/admin/menu-management',
    '/admin/landing-pages',
    '/admin/market/products',
    '/admin/generate/products',
    '/admin/problem-types',
    '/admin/ai-connections',
    '/admin/ai-question-generation-runs',
    '/admin/questions',
    '/admin/questions/upload',
    '/admin/question-bank/options',
    '/admin/question-bank/problem-types',
    '/admin/question-bank/backfill',
    '/admin/passages',
    '/admin/users',
    '/admin/roles',
    '/admin/support',
    '/admin/labels',
    '/admin/source-configs',
    '/admin/footer',
    '/admin/pricing',
    '/admin/credits',
    '/admin/refunds',
  ],
}

export const adminSidebarIconComponents: Record<AdminSidebarIconName, LucideIcon> = {
  layoutDashboard: LayoutDashboard,
  layoutPanelTop: LayoutPanelTop,
  wandSparkles: WandSparkles,
  upload: Upload,
  bookOpen: BookOpen,
  settings: Settings,
  database: Database,
  users: Users,
  userCog: UserCog,
  messageSquare: MessageSquare,
  creditCard: CreditCard,
  coins: Coins,
  refreshCcw: RefreshCcw,
  fileText: FileText,
}

function getDefaultAdminSidebarMenuItems(workspaceSubject: WorkspaceSubject): AdminSidebarMenuItem[] {
  return [
    { name: '대시보드', href: '/admin', icon: 'layoutDashboard', exact: true },
    { name: '메뉴관리', href: '/admin/menu-management', icon: 'layoutPanelTop' },
    { name: '랜딩페이지 관리', href: '/admin/landing-pages', icon: 'wandSparkles' },
    { name: '문제마켓 상품 관리', href: '/admin/market/products', icon: 'upload' },
    { name: '문제생성 상품 관리', href: '/admin/generate/products', icon: 'bookOpen' },
    { name: 'AI 문제 유형 관리', href: '/admin/problem-types', icon: 'settings' },
    { name: 'AI API 연결 관리', href: '/admin/ai-connections', icon: 'settings' },
    { name: 'AI 생성 로그', href: '/admin/ai-question-generation-runs', icon: 'fileText' },
    { name: '문제 목록', href: '/admin/questions', icon: 'database', exact: true },
    { name: '문제 업로드', href: '/admin/questions/upload', icon: 'upload' },
    { name: '연도·교재 설정', href: '/admin/question-bank/options', icon: 'settings' },
    { name: '문제유형 설정', href: '/admin/question-bank/problem-types', icon: 'settings' },
    { name: '데이터 감사·백필', href: '/admin/question-bank/backfill', icon: 'database' },
    { name: workspaceSubject === 'english' ? '영어지문 관리' : '국어지문 관리', href: '/admin/passages', icon: 'bookOpen' },
    { name: '사용자 관리', href: '/admin/users', icon: 'users' },
    { name: '회원가입 관리', href: '/admin/roles', icon: 'userCog' },
    { name: '고객지원 관리', href: '/admin/support', icon: 'messageSquare' },
    { name: '표기값 관리', href: '/admin/labels', icon: 'settings' },
    { name: '출처 관리', href: '/admin/source-configs', icon: 'settings' },
    { name: 'Footer 설정', href: '/admin/footer', icon: 'fileText' },
    { name: '요금제 관리', href: '/admin/pricing', icon: 'creditCard' },
    { name: '크레딧 관리', href: '/admin/credits', icon: 'coins' },
    { name: '환불 관리', href: '/admin/refunds', icon: 'refreshCcw' },
  ]
}

export function normalizeAdminSidebarNavigationConfig(
  input?: Partial<AdminSidebarNavigationConfig> | Json | null
): AdminSidebarNavigationConfig {
  const defaults = DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items
  const candidateItems = Array.isArray((input as AdminSidebarNavigationConfig | null)?.items)
    ? (input as AdminSidebarNavigationConfig).items
    : []
  const seen = new Set<string>()
  const ordered = candidateItems.filter((href): href is string => (
    typeof href === 'string'
    && defaults.includes(href)
    && !seen.has(href)
    && (seen.add(href), true)
  ))

  defaults.forEach((href) => {
    if (!seen.has(href)) {
      ordered.push(href)
      seen.add(href)
    }
  })

  return { items: ordered }
}

export function resolveAdminSidebarMenuItems(
  workspaceSubject: WorkspaceSubject,
  config?: AdminSidebarNavigationConfig | null
): AdminSidebarMenuItem[] {
  const defaultItems = getDefaultAdminSidebarMenuItems(workspaceSubject)
  const defaultItemsByHref = new Map(defaultItems.map((item) => [item.href, item]))
  const normalizedConfig = normalizeAdminSidebarNavigationConfig(config)

  return normalizedConfig.items
    .map((href) => defaultItemsByHref.get(href))
    .filter((item): item is AdminSidebarMenuItem => Boolean(item))
}

export function resolveAdminSidebarNavigationNodes(
  workspaceSubject: WorkspaceSubject,
  config?: AdminSidebarNavigationConfig | null
): AdminSidebarNavigationNode[] {
  const items = resolveAdminSidebarMenuItems(workspaceSubject, config)
  const questionBankItems = items.filter((item) => ADMIN_QUESTION_BANK_MENU_HREF_SET.has(item.href))
  const firstQuestionBankIndex = items.findIndex((item) => ADMIN_QUESTION_BANK_MENU_HREF_SET.has(item.href))

  if (questionBankItems.length === 0 || firstQuestionBankIndex < 0) {
    return items.map((item) => ({ type: 'item', item }))
  }

  const nodes: AdminSidebarNavigationNode[] = []

  items.forEach((item, index) => {
    if (ADMIN_QUESTION_BANK_MENU_HREF_SET.has(item.href)) {
      if (index === firstQuestionBankIndex) {
        nodes.push({
          type: 'group',
          id: 'questionBank',
          name: '문제은행',
          icon: 'database',
          items: questionBankItems,
        })
      }
      return
    }

    nodes.push({ type: 'item', item })
  })

  return nodes
}

function getAdminSidebarNodeKey(node: AdminSidebarNavigationNode) {
  return node.type === 'group' ? node.id : node.item.href
}

function getAdminSidebarNodeHrefs(node: AdminSidebarNavigationNode) {
  return node.type === 'group' ? node.items.map((item) => item.href) : [node.item.href]
}

export function moveAdminSidebarHref(
  items: string[],
  href: string,
  peerHrefs: readonly string[],
  direction: 'up' | 'down'
) {
  const currentPeerIndex = peerHrefs.indexOf(href)
  const nextPeerIndex = direction === 'up' ? currentPeerIndex - 1 : currentPeerIndex + 1

  if (currentPeerIndex < 0 || nextPeerIndex < 0 || nextPeerIndex >= peerHrefs.length) {
    return items
  }

  const currentIndex = items.indexOf(href)
  const nextIndex = items.indexOf(peerHrefs[nextPeerIndex])

  if (currentIndex < 0 || nextIndex < 0) {
    return items
  }

  const nextItems = [...items]
  const currentHref = nextItems[currentIndex]
  nextItems[currentIndex] = nextItems[nextIndex]
  nextItems[nextIndex] = currentHref
  return nextItems
}

export function moveAdminSidebarNavigationNode(
  items: string[],
  nodes: AdminSidebarNavigationNode[],
  nodeKey: string,
  direction: 'up' | 'down'
) {
  const currentNodeIndex = nodes.findIndex((node) => getAdminSidebarNodeKey(node) === nodeKey)
  const targetNodeIndex = direction === 'up' ? currentNodeIndex - 1 : currentNodeIndex + 1

  if (currentNodeIndex < 0 || targetNodeIndex < 0 || targetNodeIndex >= nodes.length) {
    return items
  }

  const currentHrefs = getAdminSidebarNodeHrefs(nodes[currentNodeIndex])
  const targetHrefs = getAdminSidebarNodeHrefs(nodes[targetNodeIndex])
  const currentHrefSet = new Set(currentHrefs)
  const withoutCurrent = items.filter((href) => !currentHrefSet.has(href))
  const targetIndexes = targetHrefs
    .map((href) => withoutCurrent.indexOf(href))
    .filter((index) => index >= 0)

  if (targetIndexes.length === 0) {
    return items
  }

  const insertIndex = direction === 'up'
    ? Math.min(...targetIndexes)
    : Math.max(...targetIndexes) + 1
  const nextItems = [...withoutCurrent]
  nextItems.splice(insertIndex, 0, ...currentHrefs)
  return nextItems
}
