'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { AdminSidebarNavigationConfig } from '@/lib/admin-sidebar'

interface AdminMenuLabelsContextValue {
  labels: Record<string, string>
  rememberSavedLabel: (key: string, label: string) => void
}

const AdminMenuLabelsContext = createContext<AdminMenuLabelsContextValue | null>(null)

// 사이드바에서 바꾼 메뉴 이름을 페이지 제목·관련 링크에서도 함께 쓴다(과목과 상관없이 하나)
export function AdminMenuLabelsProvider({
  navigationConfig,
  children,
}: {
  navigationConfig: AdminSidebarNavigationConfig
  children: ReactNode
}) {
  // 저장한 이름을 새로고침 전에도 바로 보여 준다 (빈 값은 기본 이름으로 되돌림)
  const [savedLabels, setSavedLabels] = useState<Record<string, string>>({})
  const value = useMemo<AdminMenuLabelsContextValue>(() => ({
    labels: { ...navigationConfig.labels, ...savedLabels },
    rememberSavedLabel: (key, label) => {
      setSavedLabels((current) => ({ ...current, [key]: label }))
    },
  }), [navigationConfig, savedLabels])

  return <AdminMenuLabelsContext.Provider value={value}>{children}</AdminMenuLabelsContext.Provider>
}

export function useAdminMenuLabels() {
  return useContext(AdminMenuLabelsContext)
}

export function AdminMenuName({ href, fallback }: { href: string; fallback: string }) {
  const labels = useAdminMenuLabels()?.labels

  return <>{labels?.[href] || fallback}</>
}
