import type { Metadata } from 'next'
import { getWorkspaceSettingValue, upsertWorkspaceSetting, type WorkspaceSubject } from '@/lib/workspace-settings'
import {
  ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY,
  normalizeAdminSidebarNavigationConfig,
  type AdminSidebarNavigationConfig,
} from '@/lib/admin-sidebar'
import type { Json } from '@/types/supabase'

// 관리자 사이드바의 순서·이름은 과목과 상관없이 하나다(과목별 묶음도 같은 설정을 쓴다).
// 저장 위치는 예전부터 실제로 쓰던 국어 행을 그대로 쓴다(영어 행은 더 읽지 않는다).
const ADMIN_SIDEBAR_SETTING_SUBJECT: WorkspaceSubject = 'korean'

export async function getAdminSidebarNavigationConfig(): Promise<AdminSidebarNavigationConfig> {
  const value = await getWorkspaceSettingValue<AdminSidebarNavigationConfig | Json>(
    ADMIN_SIDEBAR_SETTING_SUBJECT,
    ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY
  )

  return normalizeAdminSidebarNavigationConfig(value)
}

async function persistAdminSidebarNavigationConfig(config: AdminSidebarNavigationConfig) {
  const normalized = normalizeAdminSidebarNavigationConfig(config)

  await upsertWorkspaceSetting({
    workspaceSubject: ADMIN_SIDEBAR_SETTING_SUBJECT,
    settingKey: ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY,
    value: normalized as unknown as Json,
    description: 'Admin sidebar navigation order and labels (shared by all subjects).',
  })

  return normalized
}

// 메뉴관리의 순서 저장은 순서만 바꾸고, 사이드바에서 바꾼 이름은 그대로 둔다
export async function saveAdminSidebarNavigationConfig(config: AdminSidebarNavigationConfig) {
  const current = await getAdminSidebarNavigationConfig()
  return persistAdminSidebarNavigationConfig({ items: config.items, labels: current.labels })
}

// 빈 이름이면 기본 이름으로 되돌린다
export async function saveAdminSidebarMenuLabel(key: string, label: string) {
  const current = await getAdminSidebarNavigationConfig()
  const labels = { ...current.labels }
  const trimmedLabel = label.trim()
  if (trimmedLabel) {
    labels[key] = trimmedLabel
  } else {
    delete labels[key]
  }

  return persistAdminSidebarNavigationConfig({ items: current.items, labels })
}

// 사이드바에서 바꾼 메뉴 이름을 브라우저 탭 제목에도 쓴다
export async function buildAdminMenuMetadata(input: {
  href: string
  fallbackName: string
  searchParams?: Promise<{ subject?: string }>
  titleSuffix?: string
  description?: string
}): Promise<Metadata> {
  const config = await getAdminSidebarNavigationConfig()
  const name = config.labels?.[input.href] ?? input.fallbackName

  return {
    title: `${name} | ${input.titleSuffix ?? '관리자 패널'}`,
    ...(input.description ? { description: input.description } : {}),
  }
}
