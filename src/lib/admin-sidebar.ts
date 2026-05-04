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

export const DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG: AdminSidebarNavigationConfig = {
  items: [
    '/admin',
    '/admin/menu-management',
    '/admin/landing-pages',
    '/admin/market/products',
    '/admin/generate/products',
    '/admin/problem-types',
    '/admin/questions',
    '/admin/question-bank/options',
    '/admin/passages',
    '/admin/questions/upload',
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
    { name: '문제은행 관리', href: '/admin/questions', icon: 'database', exact: true },
    { name: '문제은행 설정', href: '/admin/question-bank/options', icon: 'settings' },
    { name: workspaceSubject === 'english' ? '영어지문 관리' : '국어지문 관리', href: '/admin/passages', icon: 'bookOpen' },
    { name: '문제 업로드', href: '/admin/questions/upload', icon: 'upload' },
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
