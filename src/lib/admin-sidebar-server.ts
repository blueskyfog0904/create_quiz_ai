import type { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { getWorkspaceSettingValue, upsertWorkspaceSetting, type WorkspaceSubject } from '@/lib/workspace-settings'
import {
  ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY,
  normalizeAdminSidebarNavigationConfig,
  type AdminSidebarNavigationConfig,
} from '@/lib/admin-sidebar'
import type { Json } from '@/types/supabase'

export async function getAdminSidebarNavigationConfig(
  workspaceSubject: WorkspaceSubject
): Promise<AdminSidebarNavigationConfig> {
  const value = await getWorkspaceSettingValue<AdminSidebarNavigationConfig | Json>(
    workspaceSubject,
    ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY
  )

  return normalizeAdminSidebarNavigationConfig(value)
}

async function persistAdminSidebarNavigationConfig(
  config: AdminSidebarNavigationConfig,
  workspaceSubject: WorkspaceSubject
) {
  const normalized = normalizeAdminSidebarNavigationConfig(config)

  await upsertWorkspaceSetting({
    workspaceSubject,
    settingKey: ADMIN_SIDEBAR_NAVIGATION_SETTING_KEY,
    value: normalized as unknown as Json,
    description: 'Workspace-scoped admin sidebar navigation order and labels.',
  })

  return normalized
}

// 메뉴관리의 순서 저장은 순서만 바꾸고, 사이드바에서 바꾼 이름은 그대로 둔다
export async function saveAdminSidebarNavigationConfig(
  config: AdminSidebarNavigationConfig,
  workspaceSubject: WorkspaceSubject
) {
  const current = await getAdminSidebarNavigationConfig(workspaceSubject)
  return persistAdminSidebarNavigationConfig({ items: config.items, labels: current.labels }, workspaceSubject)
}

// 빈 이름이면 기본 이름으로 되돌린다
export async function saveAdminSidebarMenuLabel(
  key: string,
  label: string,
  workspaceSubject: WorkspaceSubject
) {
  const current = await getAdminSidebarNavigationConfig(workspaceSubject)
  const labels = { ...current.labels }
  const trimmedLabel = label.trim()
  if (trimmedLabel) {
    labels[key] = trimmedLabel
  } else {
    delete labels[key]
  }

  return persistAdminSidebarNavigationConfig({ items: current.items, labels }, workspaceSubject)
}

// 사이드바에서 바꾼 메뉴 이름을 브라우저 탭 제목에도 쓴다
export async function buildAdminMenuMetadata(input: {
  href: string
  fallbackName: string
  searchParams?: Promise<{ subject?: string }>
  titleSuffix?: string
  description?: string
}): Promise<Metadata> {
  const resolvedSearchParams = input.searchParams ? await input.searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  const config = await getAdminSidebarNavigationConfig(workspaceSubject)
  const name = config.labels?.[input.href] ?? input.fallbackName

  return {
    title: `${name} | ${input.titleSuffix ?? '관리자 패널'}`,
    ...(input.description ? { description: input.description } : {}),
  }
}
