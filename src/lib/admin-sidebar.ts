import {
  BookOpen,
  Coins,
  CreditCard,
  Database,
  FileText,
  Images,
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
import type { AdminGuardRequirement } from '@/lib/admin-permissions'

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
  | 'images'

export interface AdminSidebarMenuItem {
  name: string
  href: string
  icon: AdminSidebarIconName
  exact?: boolean
  // 관리자가 이름을 바꿨을 때 되돌릴 기본 이름
  defaultName?: string
  // 과목별 묶음(국어 마켓·영어 마켓) 안의 메뉴일 때 그 과목. 링크와 활성 표시에 쓴다.
  subject?: WorkspaceSubject
}

export interface AdminSidebarNavigationConfig {
  items: string[]
  // 관리자가 바꾼 메뉴 이름. 키는 메뉴 주소(href) 또는 대메뉴 그룹 id
  labels?: Record<string, string>
}

export const ADMIN_SIDEBAR_LABEL_MAX_LENGTH = 30

export const ADMIN_QUESTION_BANK_MENU_HREFS = [
  '/admin/questions',
  '/admin/questions/upload',
  '/admin/question-bank/options',
  '/admin/question-bank/problem-types',
  '/admin/question-bank/backfill',
] as const

// 과목(국어·영어)마다 따로 운영하는 메뉴. 회원 화면에서 국어·영어 탭마다 내용이 다른 것(상품·카테고리·홈·후기)이다.
// 사이드바에는 과목마다 한 묶음씩("국어 마켓", "영어 마켓") 나오고, 링크는 그 과목을 들고 간다.
export const ADMIN_MARKET_MENU_HREFS = [
  '/admin/market/products',
  '/admin/market/products/new',
  '/admin/market-categories',
  '/admin/main-ad-settings',
  '/admin/market-main-settings',
  '/admin/reviews',
  '/admin/review-tags',
] as const

// 과목과 상관없는 공통 메뉴 묶음
export const ADMIN_PAYMENT_MENU_HREFS = ['/admin/orders', '/admin/refunds', '/admin/credits', '/admin/pricing'] as const
export const ADMIN_MEMBER_MENU_HREFS = ['/admin/users', '/admin/support'] as const
export const ADMIN_SITE_MENU_HREFS = [
  '/admin/market/images',
  '/admin/footer',
  '/admin/admin-accounts',
  '/admin/audit-log',
  '/admin/menu-management',
  '/admin/storefront-menu',
] as const

// 과목별 묶음을 펼치는 순서(회원 화면의 국어 → 영어 탭과 같다)
export const ADMIN_SIDEBAR_SUBJECT_ORDER: readonly WorkspaceSubject[] = ['korean', 'english']

// 사이드바 대메뉴(depth1) 그룹. 저장된 순서에서 그룹 소속 메뉴가 처음 나오는 자리에 그룹이 놓인다.
// perSubject 그룹은 사이드바에서 과목마다 한 번씩 나온다(순서·이름 설정은 하나를 같이 쓴다).
const ADMIN_SIDEBAR_MENU_GROUPS = [
  { id: 'questionBank', name: '문제은행', icon: 'database', hrefs: ADMIN_QUESTION_BANK_MENU_HREFS, perSubject: false },
  { id: 'market', name: '문제마켓', icon: 'layoutPanelTop', hrefs: ADMIN_MARKET_MENU_HREFS, perSubject: true },
  { id: 'payments', name: '주문·결제', icon: 'creditCard', hrefs: ADMIN_PAYMENT_MENU_HREFS, perSubject: false },
  { id: 'members', name: '회원·고객', icon: 'users', hrefs: ADMIN_MEMBER_MENU_HREFS, perSubject: false },
  { id: 'site', name: '사이트 설정', icon: 'settings', hrefs: ADMIN_SITE_MENU_HREFS, perSubject: false },
] as const satisfies readonly {
  id: string
  name: string
  icon: AdminSidebarIconName
  hrefs: readonly string[]
  perSubject: boolean
}[]

type AdminSidebarMenuGroupDefinition = (typeof ADMIN_SIDEBAR_MENU_GROUPS)[number]

export interface AdminSidebarMenuGroupNode {
  type: 'group'
  // 과목별로 펼친 묶음은 "market:korean"처럼 과목이 붙는다
  id: string
  // 이름 바꾸기 키(그룹 정의 id). 과목별 묶음은 둘이 같은 키를 쓴다.
  labelKey: AdminSidebarMenuGroupDefinition['id']
  name: string
  defaultName: string
  icon: AdminSidebarIconName
  items: AdminSidebarMenuItem[]
  perSubject: boolean
  subject?: WorkspaceSubject
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
    '/admin/main-ad-settings',
    '/admin/market-main-settings',
    '/admin/market/products/new',
    '/admin/market/products',
    '/admin/market/images',
    '/admin/market-categories',
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
    '/admin/orders',
    '/admin/reviews',
    '/admin/review-tags',
    '/admin/admin-accounts',
    '/admin/audit-log',
    '/admin/storefront-menu',
  ],
}

// 메뉴 → 그 화면을 여는 데 필요한 권한. 각 화면(page.tsx)의 requireAdminPagePermission과 같은 값이다
// (tests/admin-sidebar-permission-contract.test.mjs가 맞춰 본다). 'admin'은 관리자면 누구나.
export const ADMIN_SIDEBAR_MENU_REQUIREMENTS: Readonly<Record<string, AdminGuardRequirement>> = {
  '/admin': 'admin',
  '/admin/menu-management': 'owner',
  '/admin/landing-pages': 'owner',
  '/admin/main-ad-settings': 'storefront.edit',
  '/admin/market-main-settings': 'storefront.edit',
  '/admin/market/products/new': 'products.edit',
  '/admin/market/products': 'products.edit',
  '/admin/market/images': 'products.edit',
  '/admin/market-categories': 'products.edit',
  '/admin/generate/products': 'owner',
  '/admin/problem-types': 'owner',
  '/admin/ai-connections': 'owner',
  '/admin/ai-question-generation-runs': 'owner',
  '/admin/questions': 'owner',
  '/admin/questions/upload': 'owner',
  '/admin/question-bank/options': 'owner',
  '/admin/question-bank/problem-types': 'owner',
  '/admin/question-bank/backfill': 'owner',
  '/admin/passages': 'owner',
  '/admin/users': 'members.view',
  '/admin/roles': 'owner',
  '/admin/support': 'support.manage',
  '/admin/labels': 'owner',
  '/admin/source-configs': 'owner',
  '/admin/footer': 'site.manage',
  '/admin/pricing': 'pricing.manage',
  '/admin/credits': 'credits.view',
  '/admin/refunds': ['refunds.payment', 'refunds.market'],
  '/admin/orders': 'orders.view',
  '/admin/reviews': 'reviews.manage',
  '/admin/review-tags': 'reviews.manage',
  '/admin/admin-accounts': 'owner',
  '/admin/audit-log': 'owner',
  '/admin/storefront-menu': 'site.manage',
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
  images: Images,
}

function getDefaultAdminSidebarMenuItems(workspaceSubject: WorkspaceSubject): AdminSidebarMenuItem[] {
  return [
    { name: '대시보드', href: '/admin', icon: 'layoutDashboard', exact: true },
    { name: '메뉴관리', href: '/admin/menu-management', icon: 'layoutPanelTop' },
    { name: '랜딩페이지 관리', href: '/admin/landing-pages', icon: 'wandSparkles' },
    { name: '(임시)메인광고설정', href: '/admin/main-ad-settings', icon: 'layoutPanelTop' },
    { name: '(임시) 문제마켓 메인 관리', href: '/admin/market-main-settings', icon: 'layoutPanelTop' },
    { name: '문제마켓 상품 등록', href: '/admin/market/products/new', icon: 'upload' },
    { name: '문제마켓 상품 관리', href: '/admin/market/products', icon: 'fileText', exact: true },
    { name: '문제마켓 이미지 관리', href: '/admin/market/images', icon: 'images' },
    { name: '카테고리 메뉴 관리', href: '/admin/market-categories', icon: 'layoutPanelTop' },
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
    { name: '주문 조회', href: '/admin/orders', icon: 'fileText' },
    { name: '후기 관리', href: '/admin/reviews', icon: 'messageSquare' },
    { name: '후기 태그 관리', href: '/admin/review-tags', icon: 'settings' },
    { name: '관리자 ID 관리', href: '/admin/admin-accounts', icon: 'userCog' },
    { name: '작업 기록', href: '/admin/audit-log', icon: 'fileText' },
    { name: '상단 메뉴', href: '/admin/storefront-menu', icon: 'layoutPanelTop' },
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

  const candidateLabels = (input as AdminSidebarNavigationConfig | null)?.labels
  const labels: Record<string, string> = {}
  if (candidateLabels && typeof candidateLabels === 'object' && !Array.isArray(candidateLabels)) {
    Object.entries(candidateLabels).forEach(([key, value]) => {
      const label = typeof value === 'string' ? value.trim().slice(0, ADMIN_SIDEBAR_LABEL_MAX_LENGTH) : ''
      if (label && isAdminSidebarLabelKey(key)) {
        labels[key] = label
      }
    })
  }

  return { items: ordered, labels }
}

export function isAdminSidebarLabelKey(key: string) {
  return DEFAULT_ADMIN_SIDEBAR_NAVIGATION_CONFIG.items.includes(key)
    || ADMIN_SIDEBAR_MENU_GROUPS.some((group) => group.id === key)
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
    .map((item) => ({ ...item, name: normalizedConfig.labels?.[item.href] ?? item.name, defaultName: item.name }))
}

export function resolveAdminSidebarNavigationNodes(
  workspaceSubject: WorkspaceSubject,
  config?: AdminSidebarNavigationConfig | null,
  // 꺼진 기능 묶음의 메뉴와 이 계정의 권한으로 열 수 없는 메뉴(그리지 않는다)
  hiddenHrefs: readonly string[] = []
): AdminSidebarNavigationNode[] {
  const items = resolveAdminSidebarMenuItems(workspaceSubject, config).filter((item) => !hiddenHrefs.includes(item.href))
  const labels = normalizeAdminSidebarNavigationConfig(config).labels
  const findGroup = (href: string): AdminSidebarMenuGroupDefinition | undefined => (
    ADMIN_SIDEBAR_MENU_GROUPS.find((group) => (group.hrefs as readonly string[]).includes(href))
  )
  const emittedGroupIds = new Set<string>()
  const nodes: AdminSidebarNavigationNode[] = []

  items.forEach((item) => {
    const group = findGroup(item.href)
    if (!group) {
      nodes.push({ type: 'item', item })
      return
    }
    if (emittedGroupIds.has(group.id)) {
      return
    }

    emittedGroupIds.add(group.id)
    nodes.push({
      type: 'group',
      id: group.id,
      labelKey: group.id,
      name: labels?.[group.id] ?? group.name,
      defaultName: group.name,
      icon: group.icon,
      items: items.filter((candidate) => findGroup(candidate.href)?.id === group.id),
      perSubject: group.perSubject,
    })
  })

  return nodes
}

// 사이드바에 그릴 때: 과목별 묶음을 과목마다 하나씩 펼친다("국어 문제마켓", "영어 문제마켓").
// 메뉴관리(순서 편집)는 펼치지 않은 노드를 그대로 쓴다.
export function expandAdminSidebarSubjectGroups(
  nodes: AdminSidebarNavigationNode[],
  subjectLabels: Readonly<Record<WorkspaceSubject, string>>
): AdminSidebarNavigationNode[] {
  return nodes.flatMap((node) => {
    if (node.type !== 'group' || !node.perSubject) {
      return [node]
    }
    return ADMIN_SIDEBAR_SUBJECT_ORDER.map((subject): AdminSidebarMenuGroupNode => ({
      ...node,
      id: `${node.id}:${subject}`,
      name: `${subjectLabels[subject]} ${node.name}`,
      subject,
      items: node.items.map((item) => ({ ...item, subject })),
    }))
  })
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
